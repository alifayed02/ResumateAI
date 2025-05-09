import OpenAI from 'openai';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';

import { resumesBucket } from '../config/mongo_connect.js';

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

	if(user.credits < 1) {
		console.log("Not enough credits");
		return res.status(403).json({ message: 'Not enough credits' });
	}

	const resume_file_id = await createResumeFile(req.body.resume_id);

    let changes_accumulated = {};
    const sections = await getSections(resume_file_id);
    
    const changePromises = sections.map(async (section) => {
        const changes = await getChanges(resume_file_id, section, req.body.job_description);
        return { section, changes };
    });
    
    const results = await Promise.all(changePromises);
    
    results.forEach(({ section, changes }) => {
        changes_accumulated[section] = changes;
    });

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
	return resume_id;
}

async function getSections(resume_file_id) {
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
						text: "Look at the input resume file and tell me the list of sections this file has. Common sections are: Summary/Objective, Work Experience, Education, Skills, Projects, Extracurricular Activies, Languages, Volunteering Experience, Hobbies & Interests."
					}
				]
			}
		],
		text: {
			format: {
				type: "json_schema",
				name: "sections",
				schema: {
					type: "object",
					properties: {
						sections: {
							type: "array",
							items: {
								type: "string"
							}
						}
					},
					required: ["sections"],
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
	const sections = JSON.parse(last_message);

	return sections.sections;
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
						text: `You are an expert in making resumes that catch the attention of recruiters and hiring managers.\n\nUsing the uploaded file and the job description, optimize the \"${section}\" section to make this uploaded resume file the best possible candidate for the role. Your goal is to improve ATS score by including key terms in the job description in the resume, with extra emphasis on recurring terms.\n\nFor every line that you change, give me the EXACT old line in FULL as well as the new line with the changes. I want to be able to easily 'CTRL F' to find the entirety of the old text and replace it with the new text.\n\nAim for about 60-70 characters per new line. Only edit resume bullet points.\n\nHere is an exact example response (JSON) that I want from you, no more no less. Do not include whitespace whatsoever, DO NOT format it in a code block/syntax highlighting, and DO NOT include citations. Ensure the JSON is in valid format:\n\n{\n\"changes\": {\n\"0\": [\"Old line\", \"New Line\"],\n\"1\": [\"Another old line\", \"Another new line\"]\n}\n\nBelow is the job description:\n–` + job_description
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