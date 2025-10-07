// chatService.js
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const {
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
} = require('@langchain/core/prompts');

const { SYSTEM_PROMPT } = require('./systemPrompt');

// In-memory session store
const sessionHistories = new Map();

// Lazy model
let modelInstance = null;
function getModel() {
  if (modelInstance) return modelInstance;
  modelInstance = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.5-flash', // or gemini-1.5-pro if you have access
    temperature: 0.6,
  });
  return modelInstance;
}

// Create session
function createSession() {
  const id = uuidv4();
  sessionHistories.set(id, []);
  return id;
}

// Reset session
function resetSession(sessionId) {
  if (!sessionHistories.has(sessionId)) return false;
  sessionHistories.set(sessionId, []);
  return true;
}

// Get history
function getHistory(sessionId) {
  return sessionHistories.get(sessionId) || [];
}

/**
 * Send a message in a session
 * - stores user message to in-memory history
 * - formats history into the shape LangChain expects
 * - uses prompt.pipe(model) runnable pipeline and invokes with { history, input }
 */
async function sendMessage(sessionId, userMessage) {
  // Ensure session exists
  if (!sessionId) {
    sessionId = createSession();
  }
  if (!sessionHistories.has(sessionId)) {
    sessionHistories.set(sessionId, []);
  }

  // Save the user's message first
  sessionHistories.get(sessionId).push({ role: 'user', content: userMessage });

  // Format history for MessagesPlaceholder -> array of { role: 'human'|'ai', content }
  const formattedHistory = (sessionHistories.get(sessionId) || []).map((m) => ({
    role: m.role === 'user' ? 'human' : 'ai',
    content: m.content,
  }));

  // Build the ChatPromptTemplate (system + history placeholder + human input)
  const prompt = ChatPromptTemplate.fromPromptMessages([
    SystemMessagePromptTemplate.fromTemplate(SYSTEM_PROMPT),
    new MessagesPlaceholder('history'),
    HumanMessagePromptTemplate.fromTemplate('{input}'),
  ]);

  try {
    // Create a runnable pipeline: prompt -> model
    const model = getModel();
    const pipeline = prompt.pipe(model);

    // Invoke the pipeline with the variables the prompt expects.
    // IMPORTANT: history must be an array (formattedHistory), input is the userMessage
    const result = await pipeline.invoke({ history: formattedHistory, input: userMessage });

    // `result` shape depends on versions; commonly it's a string or has `.text`
    let assistantText = null;
    if (typeof result === 'string') {
      assistantText = result;
    } else if (result?.text) {
      assistantText = result.text;
    } else if (result?.output) {
      assistantText = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
    } else {
      assistantText = JSON.stringify(result);
    }

    // store assistant reply
    sessionHistories.get(sessionId).push({ role: 'assistant', content: assistantText });

    return { sessionId, reply: assistantText };
  } catch (err) {
    console.error('sendMessage error:', err);
    const errMsg = `Sorry, I encountered an error while contacting the model: ${err?.message ?? String(err)}`;
    // Add error as assistant reply in history
    sessionHistories.get(sessionId).push({ role: 'assistant', content: errMsg });
    return { sessionId, reply: errMsg, error: String(err) };
  }
}

module.exports = {
  createSession,
  resetSession,
  getHistory,
  sendMessage,
};
