import { OpenAI } from 'openai';

import dotenv from 'dotenv';
import fs from 'fs';
import PizZip from 'pizzip';
import axios from 'axios';

dotenv.config();

const client = new OpenAI();

export async function optimize(req, res) {
    const assistant = await client.beta.assistants.create({
        name: "Resume Optimizer",
        instructions: "You are a resume optimization expert. Use the following job description to improve each section of a resume:\n\n" + req.body.job_description,
        model: "gpt-4.1-mini",
        tools: [{ type: "file_search" }]
    });
    const thread = await client.beta.threads.create();
    const assistant_id = assistant.id;
    
    const resume_id = await uploadResume(thread.id);

    let changes_accumulated = [];
    const sections = await getSections(thread.id, assistant_id, resume_id);
    for (const section of sections) {
        const changes = await getChanges(thread.id, assistant_id, resume_id, section);
        changes_accumulated.push(changes);
    }
    await updateResume(changes_accumulated);

    await deleteResume(resume_id);
    res.json({ message: 'Resume optimized successfully' });
}

async function uploadResume(thread_id) {
    const file = await client.files.create({
        file: fs.createReadStream("Resume.docx"),
        purpose: "assistants"
    });
    return file.id;
}

async function getSections(thread_id, assistant_id, resume_id) {
    await client.beta.threads.messages.create(
        thread_id,
        {
            role: "user",
            content: "Using the attached resume, tell me the list of sections this resume has.\n\nHere is an exact example response (JSON) that I want from you. Only include the JSON in your response, nothing extra. No more no less:\n\n{\n\"sections\": [\"Education\", \"Work Experience\"]\n}",
            attachments: [{
                file_id: resume_id,
                tools: [{ type: "file_search" }]
            }]
        }
    );
    let run = await client.beta.threads.runs.createAndPoll(
        thread_id,
        { 
          assistant_id: assistant_id,
        }
    );
    if (run.status === 'completed') {
        const messages = await client.beta.threads.messages.list(
          run.thread_id
        );
        const last_message = messages.data[0].content[0].text.value;
        console.log("[Debug] Sections: ", last_message);
        const sections = JSON.parse(last_message);
        return sections.sections;
      } else {
        return null;
    }
}

async function getChanges(thread_id, assistant_id, resume_id, section) {
    await client.beta.threads.messages.create(
        thread_id,
        {
            role: "user",
            content: `Using the job description defined earlier, optimize the \"${section}\" section to make this resume the best possible candidate for the role. Your goal is to improve ATS score by including key terms in the job description in the resume, with extra emphasis on recurring terms.\n\nFor every line that you change, give me the EXACT old line in FULL as well as the new line with the changes. I want to be able to easily 'CTRL F' to find the entirety of the old text and replace it with the new text.\n\nAim for about 60-70 characters per new line\n\nHere is an exact example response (JSON) that I want from you. Do not include whitespace whatsoever. No more no less:\n\n{\n\"changes\": {\n\"0\": [\"Old line\", \"New Line\"],\n\"1\": [\"Another old line\", \"Another new line\"]\n}\n\nBelow is the job description:\n–`,
            attachments: [{
                file_id: resume_id,
                tools: [{ type: "file_search" }]
            }]
        }
    );
    let run = await client.beta.threads.runs.createAndPoll(
        thread_id,
        { 
          assistant_id: assistant_id,
        }
    );
    if (run.status === 'completed') {
        const messages = await client.beta.threads.messages.list(
          run.thread_id
        );
        const last_message = messages.data[0].content[0].text.value;

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
            return null;
        }
      } else {
        return null;
    }
}

async function updateResume(changes) {
    const inputPath = "Resume.docx";
    const content = fs.readFileSync(inputPath, "binary");
    const zip = new PizZip(content);
    const docXml = zip.file("word/document.xml").asText();

    let updatedXml = docXml;
    for (const change of changes) {
        const oldLine = change[0];
        const newLine = change[1];
        
        updatedXml = updatedXml.replace(oldLine, newLine);
    }
    zip.file("word/document.xml", updatedXml);

    const outputPath = "output.docx";
    const buf = zip.generate({ type: "nodebuffer" });
    fs.writeFileSync(outputPath, buf);

    console.log(`✅ Replaced text and wrote ${outputPath}`);
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
      console.log(`Deleted file ${resume_id}`, response.data);
    } catch (error) {
      console.error(`Failed to delete file ${resume_id}:`, error.response?.data || error.message);
    }
}