import { OpenAI } from 'openai';

const client = new OpenAI({
    apiKey: process.env.OPENAI_KEY,
});

export async function optimize(req, res) {
    const assistant_id = req.body.assistant_id;
    const thread = await client.beta.threads.create();

    let changes_accumulated = [];
    const sections = await getSections(thread.id, assistant_id);
    for (const section of sections) {
        const changes = await getChanges(thread.id, assistant_id);
        changes_accumulated.push(changes);
    }
    await updateResume(changes_accumulated);
    res.json({ message: 'Resume optimized successfully' });
}

async function getSections(threadId, assistantId) {
    const message = await client.beta.threads.messages.create(
        threadId,
        {
            role: "user",
            content: "Using the attached resume, tell me the list of sections this resume has.\n\nHere is an exact example response (JSON) that I want from you. Only include the JSON in your response, nothing extra. No more no less:\n\n{\n\"sections\": [\"Education\", \"Work Experience\"]\n}"
        }
    );
    let run = await client.beta.threads.runs.createAndPoll(
        threadId,
        { 
          assistant_id: assistantId,
        }
    );
    if (run.status === 'completed') {
        const messages = await client.beta.threads.messages.list(
          run.thread_id
        );
        const last_message = messages.data.reverse()[0].content[0].text.value;
        const sections = JSON.parse(last_message);

        return sections.sections;
      } else {
        return JSON.parse({ error: run.status });
    }
}

async function getChanges(thread_id, assistant_id, job_description) {
    const message = await client.beta.threads.messages.create(
        thread_id,
        {
            role: "user",
            content: `Using the job description defined below, optimize the \"Work Experience\" section to make this resume the best possible candidate for the role. Your goal is to improve ATS score by including key terms in the job description in the resume, with extra emphasis on recurring terms.\n\nFor every line that you change, give me the EXACT old line as well as the new line with the changes. I want to be able to easily 'CTRL F' to find the old text and replace it with the new text.\n\nAim for about 60-70 characters per new line\n\nHere is an exact example response (JSON) that I want from you. No more no less:\n\n{\n\"changes\": {\n\"0\": [\"Old line\", \"New Line\"],\n\"1\": [\"Another old line\", \"Another new line\"]\n}\n\nBelow is the job description:\n–` + job_description
        }
    );
    let run = await client.beta.threads.runs.createAndPoll(
        threadId,
        { 
          assistant_id: assistantId,
        }
    );
    if (run.status === 'completed') {
        const messages = await client.beta.threads.messages.list(
          run.thread_id
        );
        const last_message = messages.data.reverse()[0].content[0].text.value;

        try {
            const changeJson = JSON.parse(last_message);
            const changes = [];
            
            for (const key in changeJson.changes) {
                if (Object.hasOwnProperty.call(changeJson.changes, key)) {
                    changes.push(changeJson.changes[key]);
                }
            }
            
            return changes;
        } catch (error) {
            console.error("Error parsing changes:", error);
            return [];
        }
      } else {
        return [];
    }
}

async function updateResume(changes) {
}