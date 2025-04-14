import { OpenAI } from 'openai';

const client = new OpenAI({
    apiKey: process.env.OPENAI_KEY,
});


    /*
        1. Set assistant persona
        2. Get resume
        3. Extract sections from resume
            3a. "Using the attached resume, tell me the list of sections this resume has.

                Here is an exact example response that I want from you. No more no less:

                <sections>
                    <section>Education</section>
                    <section>Work Experience</section>
                </sections>"
        4. Optimize the resume
            4a. "Using the job description defined below, optimize the "Work Experience" section to make this resume the best possible candidate for the role. Your goal is to improve ATS score by including key terms in the job description in the resume, with extra emphasis on reoccurring terms. 

            For every line that you change, give me the EXACT old line as well as the new line with the changes. I want to be able to easily 'CTRL F' to find the old text and replace it with the new text. 

            Here is an exact example response that I want from you. No more no less:

            <changes>
                <change>
                    <old_line>This is the old line</old_line>
                    <new_line>This is the new line</new_line>
                </change>
                <change>
                    <old_line>This is a second old line</old_line>
                    <new_line>This is a second new line</new_line>
                </change>
            </changes>

            Below is the job description:
            <job_description>
            INSERT DESCRIPTION HERE
            </job_description>"
            4b. Run prompt for every important section
        5. Parse JSON and replace text in the .docx file
        6. Return the optimized resume
    */
export async function optimize(req, res) {
    const assistant_id = req.body.assistant_id;
    const thread = await client.beta.threads.create();
    const message = await client.beta.threads.messages.create(
        thread.id,
        {
          role: "user",
          content: "Using the attached resume, tell me the list of sections this resume has.\n\nHere is an exact example response that I want from you. No more no less:\n\n<sections>\n<section>Education</section>\n<section>Work Experience</section>\n</sections>"
        }
      );
}