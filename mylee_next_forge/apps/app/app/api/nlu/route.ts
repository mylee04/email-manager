import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = process.env.GEMINI_MODEL_NAME || "gemini-pro";
const TEMPERATURE = parseFloat(process.env.GEMINI_TEMPERATURE || "0.2");
const TEMPERATURE_FOLLOW_UP = parseFloat(process.env.GEMINI_TEMPERATURE_FOLLOW_UP || "0.5");
const MAX_OUTPUT_TOKENS = parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || "256");

const genAI = new GoogleGenerativeAI(API_KEY!);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

const generationConfig = {
  temperature: TEMPERATURE,
  topK: 1,
  topP: 1,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
};

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

export async function POST(request: NextRequest) {
  if (!API_KEY) {
    console.error("GEMINI_API_KEY is not set");
    return NextResponse.json({
      success: false,
      speak: "AI service configuration error on the server.",
      message: "API Key not configured"
    }, { status: 500 });
  }

  console.log(`Using Gemini model: ${MODEL_NAME} with temperature: ${TEMPERATURE}`);

  try {
    const { utterance, url: currentTabUrl, context_data, is_follow_up } = await request.json();

    if (!utterance) {
      return NextResponse.json({
        success: false,
        message: 'Utterance is required.'
      }, { status: 400 });
    }

    const promptParts = [
      `You are an AI Email Assistant that can control a web browser through Chrome Extension.
      Current page: ${currentTabUrl || 'Unknown page'}
      
      IMPORTANT: You can perform actual browser actions! When users ask to interact with emails, 
      you should provide specific browser actions, not just apologize.
      
      Available actions:
      - CLICK: Click elements (emails, buttons, links)
      - GET_TEXT: Extract text from page elements  
      - COUNT_ELEMENTS: Count number of elements matching selector
      - TYPE_TEXT: Type into input fields
      
      Gmail CSS selectors (use these exactly):
      - Email row: "tr.zA"
      - Email subject in list: "span.bog" 
      - Email subject when opened: "h2[data-legacy-thread-id]"
      - Email sender: "span.yP"
      - Unread emails: "tr.zA.zE"
      - Email body when opened: "div.a3s.aiL"
      - Compose button: "div[role='button'][gh='cm']"
      
      User command: "${utterance}"
      ${context_data ? `Previous browser data: "${context_data}"` : ''}
      ${is_follow_up ? 'This is a follow-up after browser action.' : ''}
      
      CONTEXT AWARENESS:
      - If this is a follow-up and context_data contains "count_result:", respond with the count
      - If this is a follow-up and context_data contains "email_content:", provide summary or reading
      - Remember the conversation flow and don't ask redundant questions
      
      NATURAL LANGUAGE UNDERSTANDING:
      - "unread emails", "unseen emails", "emails I didn't read", "emails I haven't read", "new emails" → COUNT unread emails
      - "read this email", "what does this say", "tell me what this email says" → GET_TEXT email content
      - "summarize", "summary", "what's this about", "give me the gist" → GET_TEXT for summarization
      - "title", "subject", "what's the subject", "what's this email about" → GET_TEXT email subject
      - "first email", "open first email" → CLICK first email
      
      SPECIAL HANDLING FOR FOLLOW-UPS:
      - If user says "yes" or "yeah" after a question, proceed with the suggested action
      - If context shows email content was retrieved, don't ask what they want again
      - Be proactive and helpful, not repetitive
      
      ALWAYS respond with JSON containing:
      {
        "speak": "what to say to user",
        "browser_action": {action object or null},
        "requires_follow_up": true/false
      }
      
      EXAMPLES:
      
      Follow-up with count_result:
      Context: "count_result: 7"
      Response: {
        "speak": "You have 7 unread emails.",
        "browser_action": null,
        "requires_follow_up": false
      }
      
      Follow-up with email content:
      Context: "email_content: [long text]"
      Response: {
        "speak": "This email is from SoFi about student loans. They're offering private student loans with competitive rates and no fees. Would you like me to summarize the key points?",
        "browser_action": null,
        "requires_follow_up": false
      }
      
      Command: "how many unread emails" or "unseen emails" or "emails I didn't read"
      Response: {
        "speak": "Let me check your unread emails.",
        "browser_action": {
          "type": "COUNT_ELEMENTS",
          "selector": "tr.zA.zE"
        },
        "requires_follow_up": true
      }
      
      Command: "read this email"
      Response: {
        "speak": "Let me get the email content for you.",
        "browser_action": {
          "type": "GET_TEXT", 
          "selector": "div.a3s.aiL"
        },
        "requires_follow_up": true
      }
      
      Command: "summarize this email" or "요약해줘"
      Response: {
        "speak": "Let me get the email content to summarize it for you.",
        "browser_action": {
          "type": "GET_TEXT", 
          "selector": "div.a3s.aiL"
        },
        "requires_follow_up": true
      }
      
      Command: "open first email"
      Response: {
        "speak": "Opening the first email for you.",
        "browser_action": {
          "type": "CLICK",
          "selector": "tr.zA:first-child"
        },
        "requires_follow_up": false
      }
      
      Command: "read the title" or "what's the subject"
      Response: {
        "speak": "Let me read the email subject for you.",
        "browser_action": {
          "type": "GET_TEXT", 
          "selector": "h2[data-legacy-thread-id]"
        },
        "requires_follow_up": true
      }
      
      Command: "hello"
      Response: {
        "speak": "Hello! I can help you manage your emails.",
        "browser_action": null,
        "requires_follow_up": false
      }
      
      Be proactive! If user wants email interaction, provide browser_action.
      Only respond with the JSON object.`
    ];

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: promptParts.join('\n') }] }],
      generationConfig,
      safetySettings,
    });

    if (result.response) {
      let geminiResponseText = result.response.candidates[0].content.parts[0].text;
      console.log("Gemini Raw Response:", geminiResponseText);

      geminiResponseText = geminiResponseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      try {
        const parsedResponse = JSON.parse(geminiResponseText);
        console.log("Parsed Response with Browser Action:", parsedResponse);
        return NextResponse.json({ success: true, ...parsedResponse });
      } catch (parseError) {
        console.error("Error parsing Gemini response as JSON:", parseError);
        return NextResponse.json({
          success: true,
          speak: `I understood: "${geminiResponseText}". However, there was an issue processing the structured action.`,
          browser_action: null,
          requires_follow_up: false
        });
      }
    } else {
      console.warn("No response from Gemini");
      return NextResponse.json({
        success: false,
        speak: "I'm sorry, I couldn't process your request.",
        message: "No response from AI service"
      }, { status: 500 });
    }

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return NextResponse.json({
      success: false,
      speak: "Sorry, an unexpected error occurred with the AI service.",
      message: error.message
    }, { status: 500 });
  }
}