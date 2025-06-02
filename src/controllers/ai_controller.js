import OpenAI from 'openai';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { exec } from 'child_process';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import { resumesBucket, optimizedResumesBucket } from '../config/mongo_connect.js';

import UserModel from '../models/user_model.js';

dotenv.config();

const client = new OpenAI();

export async function optimize(req, res) {
	if(!req.body.resume_id || !req.body.job_description || !req.body.firebase_id) {
		return res.status(400).json({ message: 'Missing details in body' });
	}

	const user = await UserModel.findOne({ firebase_id: req.body.firebase_id });
	if(!user) {
		return res.status(404).json({ message: 'User not found' });
	}

	if(user.credits < 1 && user.membership === "free") {
		console.log("User has no credits or is not subscribed");
		return res.status(403).json({ message: 'Please purchase credits or subscribe to Monthly Unlimited' });
	}

	const { resume_id: resume_file_id, links } = await createResumeFile(req.body.resume_id);

    let changes_accumulated = {};
    const info = await getInfo(resume_file_id);
	
	// Add extracted links to the info object
	info.info.links = links;
	
	const details = info.info;
	const sections = info.sections;
    
    const changePromises = sections.map(async (section) => {
        const changes = await getChanges(resume_file_id, section, req.body.job_description);
        return { section, changes };
    });
    
    const results = await Promise.all(changePromises);
    
    results.forEach(({ section, changes }) => {
        changes_accumulated[section] = changes;
    });

    const generatedLatex = await generateResume(resume_file_id, changes_accumulated, details);
    if (generatedLatex) {
        try {
            const fileId = await uploadPDF(generatedLatex, user);
            console.log("Optimized PDF processing completed, fileId:", fileId);
        } catch (error) {
            console.error("Error during PDF generation or upload:", error);
        }
    }

    await deleteResources(resume_file_id);

	console.log(changes_accumulated);

    user.credits -= 1;
    await user.save();

    res.json({ message: 'Resume optimized successfully', changes_accumulated });
}

async function createResumeFile(resume_file_id) {
	const fileId = new ObjectId(resume_file_id);
	const filesColl = mongoose.connection.db.collection('resumes.files');
	const fileDoc = await filesColl.findOne({ _id: fileId });
	if (!fileDoc) {
		throw new Error('File not found in GridFS');
	}
	const tmpPath = path.join(os.tmpdir(), `${resume_file_id}-${fileDoc.filename}`);
	console.log(tmpPath);
	await pipeline(
	  resumesBucket.openDownloadStream(fileId),
	  fs.createWriteStream(tmpPath)
	);
	
	// Extract links from the PDF before uploading to OpenAI
	let extractedLinks = [];
	try {
		extractedLinks = await getLinks(tmpPath);
		console.log(`Extracted ${extractedLinks.length} links from PDF`);
	} catch (error) {
		console.error(`Error extracting links from PDF:`, error);
		// Continue without links if extraction fails
	}
	
	const file = await client.files.create({
		file: fs.createReadStream(tmpPath), 
		purpose: "user_data"
	});

	fs.unlink(tmpPath, (err) => {
		if (err) {
			console.error(`Error deleting temporary file ${tmpPath}:`, err);
		} else {
			console.log(`Temporary file ${tmpPath} deleted successfully`);
		}
	});

	const resume_id = file.id;
	console.log(`OpenAI file created successfully with ID: ${resume_id}`);
	return { resume_id, links: extractedLinks };
}

async function getLinks(filePath) {
	const data = new Uint8Array(fs.readFileSync(filePath));

	const loadingTask = pdfjsLib.getDocument({ data });
	const pdfDocument = await loadingTask.promise;

	const urls = new Set();

	for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
		const page = await pdfDocument.getPage(pageNum);

		const annotations = await page.getAnnotations();

		for (const annot of annotations) {
			if (annot.subtype === "Link" && annot.url) {
				urls.add(annot.url);
			} else if (annot.subtype === "Link" && annot.dest) {
			}
		}
	}

	return Array.from(urls);
}

async function getInfo(resume_file_id) {
	const response = await client.responses.create({
		model: "gpt-4o-mini",
		input: [
			{
				role: "user",
				content: [
					{
						type: "input_file",
						file_id: resume_file_id
					},
					{
						type: "input_text",
						text: `Look at the input resume file and tell me the list of sections this file has. 
						Common sections are: Summary/Objective, Work Experience, Education, Skills, Projects, Extracurricular Activies, Languages, 
						Volunteering Experience, Hobbies & Interests.
						
						I want you to also extract the candidate's full name, location, phone number, and email.`
					}
				]
			}
		],
		text: {
			format: {
			  	type: "json_schema",
			  	name: "resume_data",
			  	schema: {
					type: "object",
					properties: {
						info: {
							type: "object",
							properties: {
								name:       { type: "string" },
								location:   { type: "string" },
								number:     { type: "string" },
								email:      { type: "string", format: "email" },
							},
							required: ["name", "location", "number", "email"],
							additionalProperties: false
						},
						sections: {
							type: "array",
							items: { type: "string" }
						}
					},
					required: ["info", "sections"],
					additionalProperties: false
			  	}
			}
		}
	});

	if(!response.output_text) {
		console.error("[Error] Failed to get sections");
		return null;
	}

	const last_message = response.output_text;
	console.log("[Debug] Sections: ", last_message);
	const info = JSON.parse(last_message);

	return info;
}

async function getChanges(resume_file_id, section, job_description) {
	const response = await client.responses.create({
		model: "gpt-4.1-mini",
		input: [
			{
				role: "user",
				content: [
					{
						type: "input_file",
						file_id: resume_file_id
					},
					{
						type: "input_text",
						text: `You are an expert in making resumes that catch the attention of recruiters and hiring managers.
						
						Using the uploaded file and the job description, optimize the \"${section}\" section to make this uploaded resume file the best 
						possible candidate for the role. Your goal is to improve ATS score by including key terms in the job description in the resume, 
						with extra emphasis on recurring terms.

						Make sure you are only looking at the \"${section}\" section and make sure the tailored bullet point agrees with the context of the original bullet point.
						
						For every line that you change, give me the EXACT old line in FULL as well as the new 
						line with the changes. I want to be able to easily 'CTRL F' to find the entirety of the old text and replace it with the new text.
						
						Aim for about 60-70 characters per new line. Only edit resume bullet points.\n\nHere is an exact example response (JSON) that I want 
						from you, no more no less. Do not include whitespace whatsoever, DO NOT format it in a code block/syntax highlighting, and DO NOT 
						include citations. Ensure the JSON is in valid format:
						
						{
						\"changes\": {
						\"0\": [\"Old line\", \"New Line\"],
						\"1\": [\"Another old line\", \"Another new line\"]
						}

						Below is the job description:
						
						` + job_description
					}
				]
			}
		]
	});

	if(!response.output_text) {
		return null;
	}

	const last_message = response.output_text;

	try {
		console.log("[Debug] Changes: ", last_message);
		const changeJson = JSON.parse(last_message);
		  
		const changes = [];
		for (const key in changeJson.changes) {
			if (Object.hasOwnProperty.call(changeJson.changes, key)) {
				changes.push(changeJson.changes[key]);
			}
		}

		console.log(`[Debug] Successfully parsed ${section}`);
		
		return changes;
	} catch (error) {
		console.error(`[Error] Error parsing ${section}:`, error);
		console.log("[Error] Raw message:", last_message);
		return null;
	}
}

async function generateResume(resume_file_id, changes_accumulated, details) {
	const response = await client.responses.create({
		model: "gpt-4.1-mini",
		input: [
			{
				role: "user",
				content: [
					{
						type: "input_file",
						file_id: resume_file_id
					},
					{
						type: "input_text",
						text: `You are an expert in generating human readable and ATS parsable LaTeX resumes. You are also an expert in LaTex syntax and can write LaTeX code with ease. You will help me create a resume in LaTeX given an example format.\n\n
							Below you are given four pieces of information: an original resume (attached as a document), a JSON of changes to make in that resume (wrapped in a <changes> tag), a JSON of personal details regarding the resume (wrapped in a <details> tag), and an example resume written in LaTeX (wrapped in a <latex> tag).\n\n
							
							The JSON of changes to make is written in this format:
							
							{
								ResumeSection1: [
									["old bullet 1", "new bullet 1"],
									["old bullet 2", "new bullet 2"]
								],
								ResumeSection2: [
									["old bullet 1", "new bullet 1"],
									["old bullet 2", "new bullet 2"]
								]
							}

							You are to replace the exact old bullets in the resume with the exact new bullets. Make sure personal details, project names & dates, company names & dates, tools use, etc. are correctly included. Do NOT change anything else.

							Give me JUST the resulting LaTeX, nothing more nothing less. DO NOT format it in a code block/syntax highlighting, and DO NOT include citations. Make sure necessary characters are escaped with a \\ (like #, %, etc.). It is crucial that the LaTeX is valid.\n
							
							--

							<changes>
							` + JSON.stringify(changes_accumulated) + `
							</changes>

							<details>
							` + JSON.stringify(details) + `
							</details>
							
							<latex>` 
							+ `\\documentclass[letterpaper,11pt]{article}\n\n\\usepackage{latexsym}\n\\usepackage[empty]{fullpage}\n\\usepackage{titlesec}\n\\usepackage{marvosym}\n\\usepackage[usenames,dvipsnames]{color}\n\\usepackage{enumitem}\n\\usepackage[hidelinks]{hyperref}\n\\usepackage{fancyhdr}\n\\usepackage[english]{babel}\n\\usepackage{tabularx}\n\n\\input{glyphtounicode}\n\n\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyfoot{}\n\\renewcommand{\\headrulewidth}{0pt}\n\\renewcommand{\\footrulewidth}{0pt}\n\n\\addtolength{\\oddsidemargin}{-0.5in}\n\\addtolength{\\evensidemargin}{-0.5in}\n\\addtolength{\\textwidth}{1in}\n\\addtolength{\\topmargin}{-0.5in}\n\\addtolength{\\textheight}{1.0in}\n\n\\urlstyle{same}\n\\raggedbottom\n\\raggedright\n\\setlength{\\tabcolsep}{0in}\n\n\\titleformat{\\section}{\n  \\vspace{-10pt}\\scshape\\raggedright\\large\\bfseries\n}{}{0em}{}[\\color{black}\\titlerule \\vspace{-4pt}]\n\n\\pdfgentounicode=1\n\n\\newcommand{\\resumeSubheading}[4]{\n  \\vspace{-2pt}\\item\n    \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}\n      \\textbf{#1} & \\textbf{#2} \\\\\n      \\textit{\\small#3} & \\textit{\\small #4} \\\\\n    \\end{tabular*}\\vspace{-8pt}\n}\n\n\\newcommand{\\resumeProjectHeading}[3]{\n  \\item\\small{\n    \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}\n      \\textbf{#1} $\\vert$ \\textit{#2} & \\textbf{#3} \\\\\n    \\end{tabular*}\\vspace{-6pt}\n  }\n}\n\n\\newcommand{\\resumeEducation}[5]{\n  \\vspace{-4pt}\\item\n    \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}\n      \\textbf{#1} & \\textbf{#2} \\\\\n      \\textit{\\small#3} & \\textit{\\small #4}\n    \\end{tabular*}\\\\[0pt]\n    \\begin{tabular*}{0.97\\textwidth}[t]{p{0.97\\textwidth}}\n        \\small{#5}\n    \\end{tabular*}\n}\n\n\\newcommand{\\resumeSkills}[1]{\n    \\item\\small{#1}\n}\n\n\\newcommand{\\resumeItem}[1]{\\item\\small{#1 \\vspace{-2pt}}}\n\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0in, label={}]}\n\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}\n\\newcommand{\\resumeItemListStart}{\\begin{itemize}[leftmargin=0.15in, label={{\\footnotesize \\textbullet}}]}\n\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-4pt}}\n\n\\begin{document}\n\n%-----------Title (Name, Location, Number, Email, Links)-----------\n\\begin{center}\n    \\textbf{\\Huge \\scshape FirstName LastName} \\\\ \\vspace{4pt}\n    \\small Location $|$ Phone number $|$ \\href{mailto:email@example.com}{\\underline{email@example.com}} $|$ \n    \\href{https://www.linkedin.com/in/example/}{\\underline{linkedin.com/in/example}}\n    $|$ \\href{https://github.com/example}   \n\n\\end{center}\n\n%-----------EDUCATION-----------\n\\section{Education}\n\\resumeSubHeadingListStart\n    \\resumeEducation\n      {School Name}{Graduation Date}\n      {Major}{Location}\n      {Relevant Coursework: List of courses}\n\\resumeSubHeadingListEnd\n\n%-----------TECHNICAL SKILLS-----------\n\\section{Technical Skills}\n\\vspace{0pt}  % Reduce space after section title\n\\resumeSubHeadingListStart\n    \\resumeSkills{Languages: Language1, Language 2\\\\\n    Libraries: Library1, Library2\\\\\n    Tools: Tool1, Tool2}\n\\resumeSubHeadingListEnd\n\\vspace{-10pt} \n\n%-----------EXPERIENCE-----------\n\\section{Experience}\n\\resumeSubHeadingListStart\n    \\resumeSubheading{Company Name}{\\textbf{Start Date -- End Date}}\n      {Role Title}{Location}\n    \\resumeItemListStart\n      \\resumeItem{Resume point 1. \\textless{} this is a less than symbol}\n      \\resumeItem{\\textbf{Bolded} words are emphasized. \\textgreater{} this is a greater than symbol}\n    \\resumeItemListEnd\n\\resumeSubHeadingListEnd\n\n%-----------PROJECTS-----------\n\\section{Projects}\n\\resumeSubHeadingListStart\n    \\resumeProjectHeading{Project Name}{Languages/Tools used}{Start Date - End Date}\n    \\resumeItemListStart\n      \\resumeItem{Resume point 1. \\% this is a percent symbol}\n      \\resumeItem{\\textbf{Bolded} words are emphasized. \\ensuremath{\\approx} this is the approximate symbol}\n    \\resumeItemListEnd\n\n    \\resumeProjectHeading{Project Name}{Languages/Tools used}{Start Date - End Date}\n    \\resumeItemListStart\n      \\resumeItem{Resume point 1}\n      \\resumeItem{\\textbf{Bolded} words are emphasized}\n    \\resumeItemListEnd\n\\resumeSubHeadingListEnd\n\n\\end{document}` +
							`</latex>`
					}
				]
			}
		]
	});

	if(!response.output_text) {
		return null;
	}

	const source = response.output_text;

	try {
		console.log("[Debug] LaTeX: ", source);
        return source;
	} catch (error) {
		console.error(`[Error] Error processing LaTeX response:`, error);
		console.log("[Error] Raw message:", source);
		return null;
	}
}

async function uploadPDF(source, user) {
    const firebase_id = user.firebase_id;
    const tmpDir = os.tmpdir();
    const timestamp = Date.now(); // For unique filenames
    const baseFileName = `${firebase_id}_${timestamp}_optimized_resume`;
    
    const texFilePath = path.join(tmpDir, `${baseFileName}.tex`);
    const pdfFilePath = path.join(tmpDir, `${baseFileName}.pdf`);
    const auxFilePath = path.join(tmpDir, `${baseFileName}.aux`);
    const logFilePath = path.join(tmpDir, `${baseFileName}.log`);

    const cleanupFiles = async () => {
        const filesToDelete = [texFilePath, pdfFilePath, auxFilePath, logFilePath];
        for (const filePath of filesToDelete) {
            try {
                await fs.promises.unlink(filePath);
                console.log(`Deleted temporary file: ${filePath}`);
            } catch (err) {
                if (err.code !== 'ENOENT') { // Ignore if file not found
                    console.error(`Error deleting temporary file ${filePath}:`, err);
                }
            }
        }
    };

    return new Promise(async (resolve, reject) => {
        try {
            await fs.promises.writeFile(texFilePath, source, 'utf8');
            console.log(`Temporary .tex file created: ${texFilePath}`);

            const pdflatexCommand = `pdflatex -interaction=nonstopmode "${baseFileName}.tex"`;
            
            await new Promise((resolveCmd, rejectCmd) => {
                exec(pdflatexCommand, { cwd: tmpDir }, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`[UploadError] pdflatex execution failed for ${baseFileName}.tex:`, error);
                        console.error('[UploadError]pdflatex stderr:', stderr);
                        console.error('[UploadError]pdflatex stdout:', stdout);
                        // return rejectCmd(new Error(`[UploadError] pdflatex failed: ${error.message}. Stderr: ${stderr}. Stdout: ${stdout}`));
                    }
                    console.log(`pdflatex stdout for ${baseFileName}.tex:`, stdout);
                    if (stderr) {
                        console.warn(`pdflatex stderr for ${baseFileName}.tex:`, stderr); // LaTeX often has warnings
                    }
                    // Verify PDF was created
                    fs.access(pdfFilePath, fs.constants.F_OK, (err) => {
                        if (err) {
                           console.error(`[UploadError] PDF file not found after pdflatex execution: ${pdfFilePath}`);
                           return rejectCmd(new Error(`[UploadError] pdflatex completed but PDF file not found at ${pdfFilePath}. Review stdout/stderr for details. Stdout: ${stdout}. Stderr: ${stderr}`));
                        }
                        resolveCmd(stdout);
                    });
                });
            });
            console.log(`PDF generated successfully: ${pdfFilePath}`);

            const readablePdfStream = fs.createReadStream(pdfFilePath);
            const gridFsFileName = `${user._id}-optimized-resume-${timestamp}.pdf`;
            const uploadStream = optimizedResumesBucket.openUploadStream(gridFsFileName, {
                contentType: 'application/pdf',
                metadata: {
                    userId: user._id,
                    email: user.email,
                    originalFilename: `${baseFileName}.pdf`
                }
            });

            readablePdfStream.pipe(uploadStream)
                .on('error', (uploadError) => {
                    console.error('[UploadError] Error uploading optimized PDF to GridFS:', uploadError);
                    reject(uploadError); 
                })
                .on('finish', async () => {
                    try {
                        user.optimizedResumeFileId = uploadStream.id;
                        await user.save();
                        console.log(`Optimized PDF uploaded to GridFS successfully for user ${user._id}, fileId: ${uploadStream.id}`);
                        resolve(uploadStream.id);
                    } catch (saveError) {
                        console.error('[UploadError] Failed to save user after optimized PDF upload:', saveError);
                        reject(saveError);
                    }
                });

        } catch (error) {
            console.error('[UploadError] Error in uploadPDF process:', error);
            reject(error);
        } finally {
            // Ensure cleanup runs after promise settles, by awaiting it if not already done
            // However, direct await here in finally might be tricky with promise constructor
            // Let's call it and not let its failure reject the main promise if it already settled
            cleanupFiles().catch(cleanupError => {
                console.error("[UploadError] Error during final cleanup:", cleanupError);
            });
        }
    });
}

async function deleteResume(resume_id) {
    const apiKey = process.env.OPENAI_API_KEY;
    const url = `https://api.openai.com/v1/files/${resume_id}`;
  
    try {
      const response = await axios.delete(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      console.log(`Deleted file ${resume_id}`);
    } catch (error) {
      console.error(`Failed to delete file ${resume_id}:`, error.response?.data || error.message);
    }
}

async function deleteResources(resume_id) {
    await deleteResume(resume_id);
}