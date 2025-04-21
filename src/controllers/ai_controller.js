import { OpenAI } from 'openai';

import dotenv from 'dotenv';
import fs from 'fs';
import PizZip from 'pizzip';
import axios from 'axios';

dotenv.config();

const client = new OpenAI();

export async function optimize(req, res) {
    const { resume_id, vectorStore_id } = await createVectorStore();
    const assistant = await client.beta.assistants.create({
        name: "Resume Optimizer",
        instructions: "You are a resume optimization expert. Use the following job description to improve each section of a resume:\n\n" + req.body.job_description,
        model: "gpt-4.1-mini",
        tools: [{ type: "file_search" }],
        tool_resources: {
            "file_search": {
              "vector_store_ids": [vectorStore_id]
            }
          }
    });
    const thread = await client.beta.threads.create({
      tool_resources: {
        "file_search": {
          "vector_store_ids": [vectorStore_id]
        }
      }
    });
    const assistant_id = assistant.id

    let changes_accumulated = [];
    const sections = await getSections(thread.id, assistant_id);
    // for (const section of sections) {
    //     const changes = await getChanges(thread.id, assistant_id, section);
    //     changes_accumulated.push(changes);
    // }
    await updateResume(changes_accumulated);

    await deleteResources(resume_id, assistant_id, thread.id, vectorStore_id);
    res.json({ message: 'Resume optimized successfully' });
}

async function createVectorStore() {
    const file = await client.files.create({
        file: fs.createReadStream("Resume.docx"),
        purpose: "assistants"
    });
    const resume_id = file.id;
    
    const vectorStore = await client.vectorStores.create({
        name: "Resume",
        file_ids: [resume_id]
    });
    return { resume_id, vectorStore_id: vectorStore.id };
}

async function getSections(thread_id, assistant_id) {
    await client.beta.threads.messages.create(
        thread_id,
        {
            role: "user",
            content: "Using the file_search tool to look at the \"Resume.docx\" resume file, tell me the list of sections this \"Resume.docx\" has.\n\nHere is an exact example response (JSON) that I want from you, no more no less. Do not include whitespace whatsoever and DO NOT format it in a code block/syntax highlighting:\n\n{\n\"sections\": [\"Education\", \"Work Experience\"]\n}"
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

async function getChanges(thread_id, assistant_id, section) {
    await client.beta.threads.messages.create(
        thread_id,
        {
            role: "user",
            content: `Using the file_search tool to look at the \"Resume.docx\" resume file and the job description, optimize the \"${section}\" section to make this \"Resume.docx\" resume the best possible candidate for the role. Your goal is to improve ATS score by including key terms in the job description in the resume, with extra emphasis on recurring terms.\n\nFor every line that you change, give me the EXACT old line in FULL as well as the new line with the changes. I want to be able to easily 'CTRL F' to find the entirety of the old text and replace it with the new text.\n\nAim for about 60-70 characters per new line\n\nHere is an exact example response (JSON) that I want from you, no more no less. Do not include whitespace whatsoever, DO NOT format it in a code block/syntax highlighting, and DO NOT include citations:\n\n{\n\"changes\": {\n\"0\": [\"Old line\", \"New Line\"],\n\"1\": [\"Another old line\", \"Another new line\"]\n}\n\nBelow is the job description:\n–`
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
            console.log("[Error] Raw message:", last_message);
            return null;
        }
      } else {
        return null;
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function updateResume(changes) {
    // const content = fs.readFileSync("Resume.docx", "binary");
    // const zip = new PizZip(content);
    // let xml = zip.file("word/document.xml").asText();

    // for (const [oldLine, newLine] of changes) {
    //     const pattern = new RegExp(escapeRegExp(oldLine), "g");
    //     xml = xml.replace(pattern, newLine);
    // }

    // zip.file("word/document.xml", xml);

    // const buf = zip.generate({ type: "nodebuffer" });
    // fs.writeFileSync("output.docx", buf);

    // console.log(`Wrote updated file to output.docx`);
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

async function deleteAssistant(assistant_id) {
  const apiKey = process.env.OPENAI_API_KEY;
  const url = `https://api.openai.com/v1/assistants/${assistant_id}`;

  try {
    const response = await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
    });
    console.log(`Deleted assistant ${assistant_id}`);
  } catch (error) {
    console.error(`Failed to delete assistant ${assistant_id}:`, error.response?.data || error.message);
  }
}

async function deleteThread(thread_id) {
  const apiKey = process.env.OPENAI_API_KEY;
  const url = `https://api.openai.com/v1/threads/${thread_id}`;

  try {
    const response = await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
    });
    console.log(`Deleted thread ${thread_id}`);
  } catch (error) {
    console.error(`Failed to delete thread ${thread_id}:`, error.response?.data || error.message);
  }
}

async function deleteVectorStore(vectorStore_id) {
    const apiKey = process.env.OPENAI_API_KEY;
    const url = `https://api.openai.com/v1/vector_stores/${vectorStore_id}`;
  
    try {
      const response = await axios.delete(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      console.log(`Deleted vector store ${vectorStore_id}`);
    } catch (error) {
      console.error(`Failed to delete vector store ${vectorStore_id}:`, error.response?.data || error.message);
    }
}

async function deleteResources(resume_id, assistant_id, thread_id, vectorStore_id) {
    await deleteResume(resume_id);
    await deleteThread(thread_id);
    await deleteAssistant(assistant_id);
    await deleteVectorStore(vectorStore_id);
}