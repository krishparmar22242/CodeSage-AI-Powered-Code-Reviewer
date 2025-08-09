// index.js
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const cors = require('cors');
const ejs = require('ejs');
const path = require('path');
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Allow cross-origin requests
app.use(express.json()); // Parse JSON bodies
app.use(express.static('public')); // Serve static files from the 'public' directory

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// API Endpoint for Code Review
app.post('/api/review', async (req, res) => {
    try {
        const { code, language } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Code is required for review.' });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // --- PROMPT ENGINEERING: THE BIG CHANGE IS HERE ---
        // We are now asking for a JSON object with TWO keys: 'review' and 'fixedCode'.
        const prompt = `
            Act as an expert code reviewer for ${language} code.
            Your task is to analyze the following code and provide two things in your response:
            1. A JSON array of issue objects.
            2. The complete, refactored code with all identified issues fixed.

            Here is the required structure for your response. It MUST be a single, valid JSON object:
            {
              "review": [
                {
                  "line": <line_number>,
                  "type": "Error" | "Warning" | "Suggestion",
                  "message": "<A clear explanation of the issue>",
                  "suggestion": "<A concrete example of the fix>"
                }
              ],
              "fixedCode": "<The full code snippet with all suggestions applied. Use \\n for newlines.>"
            }

            If the code is already perfect and has no issues, the "review" array should be empty, and the "fixedCode" should be the original, unmodified code.

            Here is the code to analyze:
            \`\`\`${language}
            ${code}
            \`\`\`

            Your entire response MUST be only the valid JSON object described above. Do not include any other text or markdown formatting.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Updated parsing logic to look for a JSON object {} instead of an array []
        let reviewData;
        try {
            const jsonStart = text.indexOf('{');
            const jsonEnd = text.lastIndexOf('}');

            if (jsonStart === -1 || jsonEnd === -1) {
                throw new Error("AI response was not in the expected JSON object format.");
            } else {
                const jsonString = text.substring(jsonStart, jsonEnd + 1);
                reviewData = JSON.parse(jsonString);
            }
        } catch (parseError) {
            console.error('Failed to parse Gemini response as JSON. Raw response:', text);
            return res.status(500).json({ error: 'AI returned an invalid response. Please try again.' });
        }

        // Send the entire object { review: [...], fixedCode: "..." } to the frontend
        res.json(reviewData);

    } catch (error) {
        console.error('Error during code review:', error);
        res.status(500).json({ error: 'Failed to review code. Please check the server logs.' });
    }
});



app.post('/api/report', async (req, res) => {
    const { code, language, review } = req.body;

    if (!review || !code) {
        return res.status(400).json({ error: 'Review data and code are required to generate a report.' });
    }

    try {
        const templatePath = path.join(__dirname, 'report-template.ejs');
        const html = await ejs.renderFile(templatePath, {
            review,
            code,
            language
        });

        // Set headers to trigger a file download
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', 'attachment; filename="code_review_report.html"');
        res.send(html);

    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to generate report.' });
    }
});


app.post('/api/chat', async (req, res) => {
    try {
        const { code, language, issue, question } = req.body;

        if (!issue || !question) {
            return res.status(400).json({ error: 'Issue and question are required.' });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // This prompt is specifically engineered for tutoring/explanation
        const prompt = `
            You are an expert programming tutor. A user is asking for an explanation about a code review suggestion.
            Your task is to provide a clear, helpful, and concise explanation. Do not just repeat the suggestion.
            
            Context:
            - Language: ${language}
            - Original Code Snippet:
            \`\`\`${language}
            ${code}
            \`\`\`
            - The Issue Found: "${issue.message}"
            - The Suggested Fix: "${issue.suggestion}"

            User's Question: "${question}"

            Please provide a friendly and educational response that directly answers the user's question. Explain the "why" behind the suggestion. Use markdown for code formatting.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        
        res.json({ explanation: response.text() });

    } catch (error) {
        console.error('Error in chat explanation:', error);
        res.status(500).json({ error: 'Failed to get explanation.' });
    }
});


app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});