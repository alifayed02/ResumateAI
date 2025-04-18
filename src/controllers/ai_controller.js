import { OpenAI } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const client = new OpenAI();

export async function optimize(req, res) {
    const assistant = await client.beta.assistants.create({
        name: "Resume Optimizer",
        instructions: "You are a resume optimization expert. Use the following job description to improve each section of a resume:\n\n" + req.body.job_description,
        model: "gpt-4o-mini",
        tools: [{ type: "file_search" }]
    });
    const assistant_id = assistant.id;
    const thread = await client.beta.threads.create();

    let changes_accumulated = [];
    const sections = await getSections(thread.id, assistant_id);
    for (const section of sections) {
        const changes = await getChanges(thread.id, assistant_id, section);
        changes_accumulated.push(changes);
    }
    await updateResume(changes_accumulated);
    res.json({ message: 'Resume optimized successfully' });
}

async function getSections(thread_id, assistant_id) {
    const message = await client.beta.threads.messages.create(
        thread_id,
        {
            role: "user",
            content: "Using the attached resume, tell me the list of sections this resume has.\n\nHere is an exact example response (JSON) that I want from you. Only include the JSON in your response, nothing extra. No more no less:\n\n{\n\"sections\": [\"Education\", \"Work Experience\"]\n}"
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
        return [];
    }
}

async function getChanges(thread_id, assistant_id, section) {
    const message = await client.beta.threads.messages.create(
        thread_id,
        {
            role: "user",
            content: `Using the job description defined earlier, optimize the \"${section}\" section to make this resume the best possible candidate for the role. Your goal is to improve ATS score by including key terms in the job description in the resume, with extra emphasis on recurring terms.\n\nFor every line that you change, give me the EXACT old line as well as the new line with the changes. I want to be able to easily 'CTRL F' to find the old text and replace it with the new text.\n\nAim for about 60-70 characters per new line\n\nHere is an exact example response (JSON) that I want from you. No more no less:\n\n{\n\"changes\": {\n\"0\": [\"Old line\", \"New Line\"],\n\"1\": [\"Another old line\", \"Another new line\"]\n}\n\nBelow is the job description:\n–`
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
            const changeJson = JSON.parse(last_message);
            console.log("[Debug] Changes: ", changeJson);
            
            const changes = [];
            for (const key in changeJson.changes) {
                if (Object.hasOwnProperty.call(changeJson.changes, key)) {
                    changes.push(changeJson.changes[key]);
                }
            }
            
            return changes;
        } catch (error) {
            console.error("[Error] Error parsing changes:", error);
            return [];
        }
      } else {
        return [];
    }
}

async function updateResume(changes) {

}