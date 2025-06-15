import OpenAI from 'openai';
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
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

export async function calculateATS(req, res) {
	if(!req.body.job_description) {
		return res.status(400).json({ message: 'Missing details in body' });
	}

	const { firebase_id, email_verified } = req;
	const user = await UserModel.findOne({ firebase_id: firebase_id });
	if(!user) {
		return res.status(404).json({ message: 'User not found' });
	}

	if(!email_verified) {
		return res.status(403).json({ message: 'User is not verified' });
	}

	if(user.resumeFileId) {
		return calculateATSFile(req, res);
	} else if(user.resumeText) {
		return calculateATSText(req, res);
	} else {
		return res.status(400).json({ message: 'Missing details in body' });
	}
}

async function calculateATSFile(req, res) {
	const { firebase_id } = req;
	const user = await UserModel.findOne({ firebase_id: firebase_id });
	if(!user) {
		return res.status(404).json({ message: 'User not found' });
	}

	if(!user.resumeOpenAIFileId) {
		return res.status(400).json({ message: 'User has no resume' });
	}

	const prompt = `You are an expert ATS System that understands the requirements of job descriptions and ideal resumes for said job description.
	
	Compare the attached resume with the below job description like an ATS system. I want you to do the following:
	
	1. Extract keywords from the resume and key words from the job description.
	2. Give the resume a score based on how many keywords match with the job description.
	3. Give me a list of matched keywords. Make sure these keywords are explicitly stated in the resume.
	4. Give me a list of keywords that are not present in the resume (but are present in the job description) that would've given the resume a higher score.
	
	<job>
	` + req.body.job_description + `
	</job>
	`;

	const response = await client.responses.create({
		model: "gpt-4o-mini",
		input: [
			{
				role: "user",
				content: [
					{
						type: "input_file",
						file_id: user.resumeOpenAIFileId
					},
					{
						type: "input_text",
						text: prompt
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
						ats: {
							type: "object",
							properties: {
								score:  { type: "integer" },
								matched_keywords:   { type: "array", items: { type: "string" } },
								missing_keywords:   { type: "array", items: { type: "string" } },
							},
							required: ["score", "matched_keywords", "missing_keywords"],
							additionalProperties: false
						},
					},
					required: ["ats"],
					additionalProperties: false
			  	}
			}
		},
		temperature: 0.2,
		top_p: 0.9
	});

	if(!response.output_text) {
		console.error("[Error] Failed to get ATS score");
		return null;
	}

	const last_message = response.output_text;
	console.log("[Debug] ATS: ", last_message);
	const ats = JSON.parse(last_message);

	return res.status(200).json({ message: ats });
}

async function calculateATSText(req, res) {
	const { firebase_id } = req;
	const user = await UserModel.findOne({ firebase_id: firebase_id });
	if(!user) {
		return res.status(404).json({ message: 'User not found' });
	}

	if(!user.resumeText) {
		return res.status(400).json({ message: 'User has no resume' });
	}

	const prompt = `You are an expert ATS System that understands the requirements of job descriptions and ideal resumes for said job description.
	
	Compare the below resume with the below job description like an ATS system. I want you to do the following:
	
	1. Extract keywords from the resume and key words from the job description.
	2. Give the resume a score based on how many keywords match with the job description.
	3. Give me a list of matched keywords. Make sure these keywords are explicitly stated in the resume.
	4. Give me a list of keywords that are not present in the resume (but are present in the job description) that would've given the resume a higher score.
	
	<resume>
	` + user.resumeText + `
	</resume>

	<job>
	` + req.body.job_description + `
	</job>
	`;

	const response = await client.responses.create({
		model: "gpt-4o-mini",
		input: [
			{
				role: "user",
				content: [
					{
						type: "input_text",
						text: prompt
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
						ats: {
							type: "object",
							properties: {
								score:  { type: "integer" },
								matched_keywords:   { type: "array", items: { type: "string" } },
								missing_keywords:   { type: "array", items: { type: "string" } },
							},
							required: ["score", "matched_keywords", "missing_keywords"],
							additionalProperties: false
						},
					},
					required: ["ats"],
					additionalProperties: false
			  	}
			}
		},
		temperature: 0.2,
		top_p: 0.9
	});

	if(!response.output_text) {
		console.error("[Error] Failed to get ATS score");
		return null;
	}

	const last_message = response.output_text;
	console.log("[Debug] ATS: ", last_message);
	const ats = JSON.parse(last_message);

	return res.status(200).json({ message: ats });
}

export async function optimize(req, res) {
	if(!req.body.job_description) {
		return res.status(400).json({ message: 'Missing details in body' });
	}

	const { firebase_id, email_verified } = req;
	const user = await UserModel.findOne({ firebase_id: firebase_id });
	if(!user) {
		return res.status(404).json({ message: 'User not found' });
	}

	if(!email_verified) {
		return res.status(403).json({ message: 'User is not verified' });
	}

	if(user.resumeFileId) {
		return optimizeFile(req, res);
	} else if(user.resumeText) {
		return optimizeText(req, res);
	} else {
		return res.status(400).json({ message: 'User has no resume' });
	}
}

async function optimizeFile(req, res) {
	const { firebase_id } = req;
	const user = await UserModel.findOne({ firebase_id: firebase_id });
	if(!user) {
		return res.status(404).json({ message: 'User not found' });
	}

	if(user.credits < 1 && user.membership === "free") {
		console.log("User has no credits or is not subscribed");
		return res.status(403).json({ message: 'Please purchase credits or subscribe to Monthly Unlimited' });
	}

	if(!user.resumeOpenAIFileId) {
		return res.status(400).json({ message: 'User has no resume' });
	}

	const links = await getLinks(user.resumeFileId);

    let changes_accumulated = {};
    const info = await getInfoFile(user.resumeOpenAIFileId);

	console.log("[Debug]: ", links);
	
	info.info.links = links;

	console.log("[Debug]: ", info);
	
	const details = info.info;
	const sections = info.sections;
	
	const changes = await getChangesFile(user.resumeOpenAIFileId, req.body.job_description, sections);

    const generatedLatex = await generateResumeFromFile(user.resumeOpenAIFileId, changes, details);
    if (generatedLatex) {
        try {
            const fileId = await uploadPDF(generatedLatex, user);
            console.log("Optimized PDF processing completed, fileId:", fileId);
        } catch (error) {
            console.error("Error during PDF generation or upload:", error);
        }
    }

    await deleteResources(user.resumeOpenAIFileId);

	console.log(changes_accumulated);

    user.credits -= 1;
	user.resumeOpenAIFileId = null;
    await user.save();

    res.json({ message: 'Resume optimized successfully', changes_accumulated });
}

async function optimizeText(req, res) {
	const { firebase_id } = req;
	const user = await UserModel.findOne({ firebase_id: firebase_id });
	if(!user) {
		return res.status(404).json({ message: 'User not found' });
	}

	if(user.credits < 1 && user.membership === "free") {
		console.log("User has no credits or is not subscribed");
		return res.status(403).json({ message: 'Please purchase credits or subscribe to Monthly Unlimited' });
	}

    let changes_accumulated = {};
    const info = await getInfoText(user.resumeText);
	
	const details = info.info;
	const sections = info.sections;
    
	const changes = await getChangesText(user.resumeText, req.body.job_description, sections);
    
    const generatedLatex = await generateResumeFromText(user.resumeText, changes, details);
    if (generatedLatex) {
        try {
            const fileId = await uploadPDF(generatedLatex, user);
            console.log("Optimized PDF processing completed, fileId:", fileId);
        } catch (error) {
            console.error("Error during PDF generation or upload:", error);
        }
    }

	console.log(changes_accumulated);

    user.credits -= 1;
    await user.save();

    res.json({ message: 'Resume optimized successfully', changes_accumulated });
}

async function getLinks(resume_file_id) {
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

	const data = new Uint8Array(fs.readFileSync(tmpPath));

	const loadingTask = pdfjsLib.getDocument({ data });
	const pdfDocument = await loadingTask.promise;

	const urls = [];

	for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
		const page = await pdfDocument.getPage(pageNum);

		const annotations = await page.getAnnotations();

		for (const annot of annotations) {
			if (annot.subtype === "Link" && annot.url) {
				urls.push(annot.url);
			} else if (annot.subtype === "Link" && annot.dest) {
			}
		}
	}

	fs.unlink(tmpPath, (err) => {
		if (err) {
			console.error(`Error deleting temporary file ${tmpPath}:`, err);
		} else {
			console.log(`Temporary file ${tmpPath} deleted successfully`);
		}
	});

	console.log(urls);

	return urls;
}

async function getInfoFile(resume_file_id) {
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
						text: `You will be tasked with extracting sections in a resume as well as the candidate’s personal information like the candidate's full name, location, phone number, and email.
						
						Your thinking should be thorough and so it’s fine if it’s very long. You can think step by step before and after each action you decide to take.
						
						You MUST iterate and keep going until you have found all sections and personal information in the resume.
						
						The resume is attached as a file, which means you have everything you need. I want you to fully extract the sections and personal information autonomously before coming back to me.
						
						Only terminate your turn when you are sure that all sections and personal information are extracted. Go through the resume line by line, and make sure to verify that your answer is correct. NEVER end your turn without having found all the sections and personal information, and when you say you will look at the file, make sure you ACTUALLY look at the file, instead of ending your turn.
						
						Take your time and think through every step - remember to check your answer rigorously and watch out for mistakes. Your answer must be perfect. If not, continue working on it. At the end, you must check your answer to make sure all sections and personal information were extracted. All resumes may look different, so make sure to understand how the resume is formatted before trying to extract the sections and personal information.
						
						Common sections are: Summary/Objective, Work Experience, Education, Skills, Projects, Extracurricular Activities, Languages, Volunteering Experience, Hobbies & Interests
						
						Common personal information are: Full name, location, phone number, and email.
						
						# Workflow
						
						## High-Level Strategy
						
						1. Understand the format and structure of the resume.
						2. Develop a clear, step-by-step plan. Break down the problem into manageable incremental steps.
						3. Extract sections and personal information incrementally.
						4. Iterate until you have extracted all the sections and personal information.
						5. Reflect and validate comprehensively.

						## Detailed Plan

						1. Read the resume file.
						2. Identify the sections in the resume.
						3. Extract the personal information from the resume.
						4. Iterate until you have extracted all the sections and personal information.
						5. Reflect and validate comprehensively.`
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

async function getInfoText(resume_text) {
	const response = await client.responses.create({
		model: "gpt-4o-mini",
		input: [
			{
				role: "user",
				content: [
					{
						type: "input_text",
						text: `You will be tasked with extracting sections in a resume as well as the candidate’s personal information like the candidate's full name, location, phone number, and email.
						
						Your thinking should be thorough and so it’s fine if it’s very long. You can think step by step before and after each action you decide to take.
						
						You MUST iterate and keep going until you have found all sections and personal information in the resume.
						
						The resume is copy and pasted below as text, which means you have everything you need. I want you to fully extract the sections and personal information autonomously before coming back to me.
						
						Only terminate your turn when you are sure that all sections and personal information are extracted. Go through the resume line by line, and make sure to verify that your answer is correct. NEVER end your turn without having found all the sections and personal information, and when you say you will look at the resume, make sure you ACTUALLY look at the resume, instead of ending your turn.
						
						Take your time and think through every step - remember to check your answer rigorously and watch out for mistakes. Your answer must be perfect. If not, continue working on it. At the end, you must check your answer to make sure all sections and personal information were extracted. All resumes may look different, so make sure to understand how the resume is formatted before trying to extract the sections and personal information.
						
						Common sections are: Summary/Objective, Work Experience, Education, Skills, Projects, Extracurricular Activities, Languages, Volunteering Experience, Hobbies & Interests
						
						Common personal information are: Full name, location, phone number, and email.
						
						# Workflow
						
						## High-Level Strategy
						
						1. Understand the format and structure of the resume.
						2. Develop a clear, step-by-step plan. Break down the problem into manageable incremental steps.
						3. Extract sections and personal information incrementally.
						4. Iterate until you have extracted all the sections and personal information.
						5. Reflect and validate comprehensively.
						
						# Information
						
						## Resume
						` + resume_text + ``
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
								links:      { type: "array", items: { type: "string" } }
							},
							required: ["name", "location", "number", "email", "links"],
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

async function getChangesFile(resume_file_id, job_description, sections) {
	const optimized_changes = z.object({
		changes: z.array(
			z.array(z.string()).length(2)
		)
	});

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
						text: `
						You will be tasked with optimizing a resume to get a perfect score in an ATS system.  

						Your thinking should be thorough and so it's fine if it's very long. You can think step by step before and after each action you decide to take.

						You MUST iterate and keep going until the resume is perfectly optimized.  

						The resume is attached as a file and the job description is pasted at the bottom. This means that you have everything you need to optimize the resume. I want you to fully optimize the resume before coming back to me.

						Only terminate your turn when you are sure that the resume is sufficiently optimized. Go through each bullet point step by step, and make sure to verify that your changes perfectly align with the job description and that they make sense. NEVER end your turn without having optimized the resume. When you say you are going to look at the file, make sure you ACTUALLY look at the file, instead of ending your turn.
						
						Take your time and think through every step - remember to check your updates and cross-check them with the job description. Your solution must be perfect. If not, continue working on it. At the end, cross check your solution with the job description to make sure the resume is perfectly optimized. Keep iterating until you are certain your solution will score perfectly when fed to an ATS system.

						Aim for about 60-70 characters per new line.

						Your response will be strictly JSON which will contain an array of arrays. The inner array will contain 2 elements: the old line, and the new line. The old line should be the EXACT text before you make your change. The new line will be the newly optimized line. For each optimization you make, you will append this array of 2 elements to the outer array.

						# Sections

						` + sections.join(", ") + `

						# Job Description

						` + job_description + `
						
						# Workflow

						## High-Level Problem Solving Strategy

						1. Understand the resume and job description. Thoroughly analyze the job description to extract keywords, responsibilities, and required skills. Build a mental map of the ideal candidate profile.  
						2. Extract explicit and implied keywords from the job description. Group them into categories: skills, technologies, action verbs, soft skills, etc.  
						3. Identify which keywords are missing, which are present.  
						4. Modify lines in the resume to naturally and appropriately include the missing keywords. Align phrasing, responsibilities, and experiences with those emphasized in the job description. Avoid keyword stuffing to make the changes sound natural, human, and verifiable.

						5. After each edit, re-check how well the resume matches with the job description. Continue refining and editing until all relevant keywords are covered.

						6. Cross-check every section of the resume against the job description. Ensure that the resume is not only keyword-rich but also coherent, concise, and professional. Ensure every bullet point is results-driven, using strong action verbs and quantified outcomes when possible.  

						Refer to the detailed sections below for more information on each step.

						## 1. Deeply Understand the Resume and Job Description

						1. Read both documents thoroughly.  
						2. Understand what the job is truly asking for: required experience, culture fit, impact, and scope of work.  
						
						## 2. Extract and Categorize Keywords  
						1. List all important hard skills, soft skills, tools and platforms, certifications or education requirements, and job-specific responsibilities and verbs.

						## 3. Evaluate the Resume

						1. Highlight all present keywords
						2. List all missing or weakly represented keywords
						3. Highlight vague bullet points or achievements lacking metrics or action.

						## 4. Iterative Optimization and Editing

						1. Update the resume section-by-section
						2. Modify descriptions to: add missing keywords; use strong action verbs; show quantifiable outcomes; match the job scope and phrasing.

						## 5. Realignment Loop

						1. Repeat steps 2-4 until: all essential keywords are covered; resume tone and wording mirror the job description; each change makes logical sense and adds value.

						## 6. Final Checks

						1. Ensure all achievements are believable and tailored to the job

						# Example Response

						{
						"changes": [
						["This is the original text", "This is the optimized text"], ["This is another original text", "This is another optimized text"]
						]
						}

						# Remember

						1. Never end your turn without optimizing the resume
						2. Always check your edits against the job description
						3. Keep going until you are confident the resume is flawless and would score a perfect match with any modern ATS.
						`
					}
				]
			}
		],
		text: {
			format: zodTextFormat(optimized_changes, "changes")
		}
	});

	if(!response.output_text) {
		return null;
	}

	const last_message = response.output_text;

	try {
		console.log("[Debug] Changes: ", last_message);
		const changes = JSON.parse(last_message);

		console.log(`[Debug] Successfully optimized resume`);
		
		return changes;
	} catch (error) {
		console.error(`[Error] Error parsing optimized changes:`, error);
		console.log("[Error] Raw message:", last_message);
		return null;
	}
}

async function getChangesText(resume_text, job_description, sections) {
	const optimized_changes = z.object({
		changes: z.array(z.tuple([
			z.string(),
			z.string()
		]))
	});

	const response = await client.responses.create({
		model: "gpt-4.1-mini",
		input: [
			{
				role: "user",
				content: [
					{
						type: "input_text",
						text: `You will be tasked with optimizing a resume to get a perfect score in an ATS system.  

						Your thinking should be thorough and so it's fine if it's very long. You can think step by step before and after each action you decide to take.

						You MUST iterate and keep going until the resume is perfectly optimized.  

						The resume and job description are pasted below as text. This means that you have everything you need to optimize the resume. I want you to fully optimize the resume before coming back to me.

						Only terminate your turn when you are sure that the resume is sufficiently optimized. Go through each line step by step, and make sure to verify that your changes perfectly align with the job description and that they make sense. NEVER end your turn without having optimized the resume.
						
						Take your time and think through every step - remember to check your updates and cross-check them with the job description. Your solution must be perfect. If not, continue working on it. At the end, cross check your solution with the job description to make sure the resume is perfectly optimized. Keep iterating until you are certain your solution will score perfectly when fed to an ATS system.

						Aim for about 60-70 characters per new line.

						Your response will be strictly JSON which will contain an array of arrays. The inner array will contain 2 elements: the old line, and the new line. The old line should be the EXACT text before you make your change. The new line will be the newly optimized line. For each optimization you make, you will append this array of 2 elements to the outer array.

						# Sections

						` + sections.join(", ") + `

						# Resume
						
						` + resume_text + `

						# Job Description  

						` + job_description + `

						# Workflow

						## High-Level Problem Solving Strategy

						1. Understand the resume and job description. Thoroughly analyze the job description to extract keywords, responsibilities, and required skills. Build a mental map of the ideal candidate profile.  
						2. Extract explicit and implied keywords from the job description. Group them into categories: skills, technologies, action verbs, soft skills, etc.  
						3. Identify which keywords are missing, which are present.  
						4. Modify lines in the resume to naturally and appropriately include the missing keywords. Align phrasing, responsibilities, and experiences with those emphasized in the job description. Avoid keyword stuffing to make the changes sound natural, human, and verifiable.

						5. After each edit, re-check how well the resume matches with the job description. Continue refining and editing until all relevant keywords are covered.

						6. Cross-check every section of the resume against the job description. Ensure that the resume is not only keyword-rich but also coherent, concise, and professional. Ensure every bullet point is results-driven, using strong action verbs and quantified outcomes when possible.  

						Refer to the detailed sections below for more information on each step.

						## 1. Deeply Understand the Resume and Job Description

						1. Read both documents thoroughly.  
						2. Understand what the job is truly asking for: required experience, culture fit, impact, and scope of work.  
						
						## 2. Extract and Categorize Keywords  
						1. List all important hard skills, soft skills, tools and platforms, certifications or education requirements, and job-specific responsibilities and verbs.

						## 3. Evaluate the Resume

						1. Highlight all present keywords
						2. List all missing or weakly represented keywords
						3. Highlight vague bullet points or achievements lacking metrics or action.

						## 4. Iterative Optimization and Editing

						1. Update the resume section-by-section
						2. Modify descriptions to: add missing keywords; use strong action verbs; show quantifiable outcomes; match the job scope and phrasing.

						## 5. Realignment Loop

						1. Repeat steps 2-4 until: all essential keywords are covered; resume tone and wording mirror the job description; each change makes logical sense and adds value.

						## 6. Final Checks

						1. Ensure all achievements are believable and tailored to the job

						# Example Response

						{

						"changes": [

						["This is the original text", "This is the optimized text"], ["This is another original text", "This is another optimized text"]

						]

						}

						# Remember

						1. Never end your turn without optimizing the resume
						2. Always check your edits against the job description
						3. Keep going until you are confident the resume is flawless and would score a perfect match with any modern ATS.
						`
					}
				]
			}
		],
		text: {
			format: zodTextFormat(optimized_changes, "changes")
		}
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

async function generateResumeFromFile(resume_file_id, changes_accumulated, details) {
	console.log("[Debug]: ", details)
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

async function generateResumeFromText(resume_text, changes_accumulated, details) {
	const response = await client.responses.create({
		model: "gpt-4.1-mini",
		input: [
			{
				role: "user",
				content: [
					{
						type: "input_text",
						text: `You are an expert in generating human readable and ATS parsable LaTeX resumes. You are also an expert in LaTeX syntax and can write LaTeX code with ease. You will help me create a resume in LaTeX given an example format.\n\n
							Below you are given four pieces of information: an original resume (copy and pasted as text), a JSON of changes to make in that resume (wrapped in a <changes> tag), a JSON of personal details regarding the resume (wrapped in a <details> tag), and an example resume written in LaTeX (wrapped in a <latex> tag).\n\n
							
							The JSON of changes to make is written in this format:
							
							{
							"changes": [["This is the original bullet point", "This is the optimized bullet point"], ["This is another original bullet point", "This is another optimized bullet point"]]
							}

							You are to replace the exact old bullets in the resume with the exact new bullets. Make sure personal details, project names & dates, company names & dates, tools use, etc. are correctly included. Do NOT change anything else.

							Give me JUST the resulting LaTeX, nothing more nothing less. DO NOT format it in a code block/syntax highlighting, and DO NOT include citations. Make sure necessary characters are escaped with a \\ (like #, %, etc.). It is crucial that the LaTeX is valid.\n
							
							--

							<resume>
							` + resume_text + `
							</resume>

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