import db from '../lib/dbConnect.js';
import { Router } from 'express';
import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';

dotenv.config();

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMENI_API_KEY });

async function getUserByEmail(email) {
  return new Promise((resolve, reject) => {
    db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
      if (err) reject(err);
      resolve(results[0] || null);
    });
  });
}

router.post('/generate-questions', async (req, res) => {
  try {
    const { email, cv, jobDescription = null } = req.body;

    if (!email || !cv) {
      return res.status(400).json({ 
        error: 'Email and CV are required fields' 
      });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found. Please contact support to create an account.',
        code: 'USER_NOT_FOUND'
      });
    }

    if (!user.is_verified) {
      return res.status(403).json({ 
        success: false,
        error: 'Your email is not verified. Please contact support for account verification.',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    const sessionType = jobDescription ? 'cv_with_job' : 'cv_only';
    const sessionTitle = `Interview Session - ${new Date().toLocaleDateString()}`;
    
    const sessionId = await createInterviewSession(
      user.id, 
      sessionTitle, 
      cv, 
      jobDescription, 
      sessionType
    );

    const prompt = createInterviewPrompt(cv, jobDescription);

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    console.log('AI Response:', response.text); 

    const questions = parseQuestionsFromAI(response.text);
    console.log('Parsed Questions:', questions.length); 
    await saveQuestionsToDatabase(sessionId, questions);

    const savedQuestions = await getQuestionsBySessionId(sessionId);

    return res.json({
      success: true,
      sessionId: sessionId,
      userId: user.id,
      sessionType: sessionType,
      totalQuestions: savedQuestions.length,
      questions: savedQuestions.map(q => ({
        id: q.id,
        question: q.question_text,
        type: q.question_type,
        difficulty: q.difficulty_level,
        order: q.order_index,
      }))
    });

  } catch (error) {
    console.error('Error generating questions:', error);
    return res.status(500).json({ 
      error: 'Failed to generate interview questions',
      details: error.message 
    });
  }
});

router.get('/session/:sessionId/questions', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { showAnswers = false } = req.query;

    const questions = await getQuestionsBySessionId(sessionId);
    
    const formattedQuestions = questions.map(q => ({
      id: q.id,
      question: q.question_text,
      type: q.question_type,
      difficulty: q.difficulty_level,
      order: q.order_index,
      isAnswered: q.is_answered,
      ...(showAnswers === 'true' && { answer: q.suggested_answer })
    }));

    return res.json({
      success: true,
      sessionId: parseInt(sessionId),
      questions: formattedQuestions
    });

  } catch (error) {
    console.error('Error fetching questions:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch questions',
      details: error.message 
    });
  }
});

router.get('/user/:email/sessions', async (req, res) => {
  try {
    const { email } = req.params;
    
    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found. Please contact support to create an account.',
        code: 'USER_NOT_FOUND'
      });
    }

    const sessions = await getUserSessions(user.id);
    
    return res.json({
      success: true,
      userId: user.id,
      sessions: sessions
    });

  } catch (error) {
    console.error('Error fetching sessions:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch sessions',
      details: error.message 
    });
  }
});


async function createInterviewSession(userId, title, cvText, jobDescription, sessionType) {
  return new Promise((resolve, reject) => {
    db.query(
      'INSERT INTO interview_sessions (user_id, title, cv_text, job_description, session_type) VALUES (?, ?, ?, ?, ?)',
      [userId, title, cvText, jobDescription, sessionType],
      (err, result) => {
        if (err) reject(err);
        resolve(result.insertId);
      }
    );
  });
}

function createInterviewPrompt(cv, jobDescription) {
  let prompt = `You are an expert HR interviewer. Analyze the provided CV and generate exactly 20 relevant, professional interview questions with HIGH-QUALITY, SPECIFIC answers.

CV:
${cv}

`;
  
  if (jobDescription) {
    prompt += `Job Description:
${jobDescription}

Instructions: Generate questions that assess both the candidate's background (from CV) and their fit for this specific role (from job description).
`;
  } else {
    prompt += `Instructions: Generate questions based solely on the candidate's CV, focusing on their experience, skills, and background.
`;
  }
  
  prompt += `
Question Distribution:
- 4 General questions (background, motivation, career goals)
- 6 Technical questions (based on skills and technologies mentioned in CV)
- 4 Behavioral questions (using STAR method scenarios)
- 4 CV-specific questions (about specific experiences, projects, or achievements mentioned)
${jobDescription ? '- 2 Job-specific questions (tailored to the job requirements and how CV aligns)' : '- 2 Additional experience-based questions'}

CRITICAL ANSWER REQUIREMENTS:
1. For technical questions: Provide DIRECT, SPECIFIC answers with concrete examples, comparisons, and best practices
2. For comparison questions: Give definitive answers about which tool/approach is better and WHY
3. For skill-based questions: Provide actual implementation details, code snippets concepts, or methodologies
4. For experience questions: Create realistic, detailed scenarios based on the CV content
5. For behavioral questions: Provide STAR method examples that feel authentic and specific
6. For general questions: Give thoughtful, professional responses that sound like a real candidate would say

AVOID these in answers:
- "The candidate should..."
- "One should consider..."
- "It's important to..."
- Generic advice or study suggestions
- Vague recommendations

INSTEAD provide:
- Direct statements and opinions
- Specific examples and scenarios
- Concrete technical details
- Definitive comparisons with reasoning
- Realistic personal experiences based on CV

Requirements:
1. Questions must be directly relevant to the CV content
2. Technical questions should focus on technologies/skills actually mentioned in the CV
3. Behavioral questions should be applicable to the person's experience level and background
4. Vary difficulty levels: 6 easy, 8 medium, 6 hard
5. Each answer should sound like it's coming from the actual person whose CV you're analyzing

CRITICAL: Respond with ONLY a valid JSON array. No explanations, no markdown, no extra text.

Format:
[
  {
    "question": "Question text here",
    "type": "general|technical|behavioral|cv_specific|job_specific",
    "difficulty": "easy|medium|hard",
    "answer": "Direct, specific answer as if the candidate is responding - no advice or 'should do' statements"
  }
]

Examples of GOOD answers:
- Technical: "I prefer React over Vue because React's component lifecycle and hooks provide better state management flexibility. In my last project, I used useEffect with cleanup functions to handle API calls efficiently..."
- Comparison: "PostgreSQL is better than MySQL for complex queries due to its advanced indexing and JSON support. I've used both, and PostgreSQL's performance with joins on large datasets is significantly better..."
- Behavioral: "At XYZ Company, we had a critical bug in production affecting 10,000+ users. I immediately set up monitoring, identified the root cause in our caching layer within 30 minutes, and deployed a hotfix that resolved the issue..."

Analyze the CV thoroughly and create questions with answers that sound authentic and knowledgeable.`;

  return prompt;
}

function createGenericFallbackQuestions() {
  return [
    {
      question_text: "Tell me about yourself and your professional background.",
      question_type: "general",
      difficulty_level: "easy",
      suggested_answer: "I'm a software developer with 3+ years of experience building web applications. I started my career at a startup where I worked with React and Node.js, then moved to a larger company where I focused on microservices architecture. I'm passionate about clean code and user experience, and I enjoy solving complex technical problems while collaborating with cross-functional teams.",
      order_index: 1
    },
    {
      question_text: "What are your greatest professional strengths?",
      question_type: "general",
      difficulty_level: "easy",
      suggested_answer: "My greatest strength is problem-solving under pressure. I have a systematic approach where I break down complex issues into smaller components, research thoroughly, and implement solutions quickly. For example, I once debugged a critical production issue that was affecting our payment system by tracing through logs and identifying a race condition in our database transactions.",
      order_index: 2
    },
    {
      question_text: "Describe a challenging project you worked on and how you overcame obstacles.",
      question_type: "behavioral",
      difficulty_level: "medium",
      suggested_answer: "I was tasked with migrating our legacy PHP application to a modern React/Node.js stack within 6 months. The main challenge was maintaining business continuity while rebuilding core features. I created a detailed migration plan, implemented feature flags for gradual rollout, and set up comprehensive testing. We completed the migration 2 weeks ahead of schedule and improved page load times by 60%.",
      order_index: 3
    },
    {
      question_text: "How do you stay updated with the latest trends and technologies in your field?",
      question_type: "general",
      difficulty_level: "easy",
      suggested_answer: "I follow several tech blogs like Hacker News and Dev.to, subscribe to newsletters from companies like Vercel and GitHub, and participate in developer communities on Discord. I also attend local meetups monthly and take online courses on platforms like Pluralsight. Recently, I completed a course on GraphQL and implemented it in a side project to understand its benefits over REST APIs.",
      order_index: 4
    },
    {
      question_text: "Tell me about a time when you had to work under pressure or tight deadlines.",
      question_type: "behavioral",
      difficulty_level: "medium",
      suggested_answer: "During Black Friday last year, our e-commerce platform experienced a 500% traffic spike that caused performance issues. I had 4 hours to optimize the system before peak shopping hours. I implemented Redis caching for product queries, optimized database indexes, and set up load balancing. The changes reduced response times from 3 seconds to under 500ms, and we handled the traffic without any downtime.",
      order_index: 5
    },
    {
      question_text: "What technical skills do you consider your strongest, and how have you applied them?",
      question_type: "technical",
      difficulty_level: "medium",
      suggested_answer: "JavaScript and React are my strongest skills. I've built multiple production applications using React with hooks, context API, and custom hooks for state management. In my current role, I architected a dashboard application that handles real-time data updates using WebSockets and optimized rendering with React.memo and useMemo, resulting in smooth performance even with 1000+ data points updating every second.",
      order_index: 6
    },
    {
      question_text: "How do you approach problem-solving in your work?",
      question_type: "behavioral",
      difficulty_level: "medium",
      suggested_answer: "I use a structured approach: first, I reproduce the issue and gather all relevant information. Then I research similar problems and potential solutions. I break the problem into smaller parts and tackle them systematically. For example, when debugging a memory leak in our Node.js application, I used Chrome DevTools to profile memory usage, identified unused event listeners, and implemented proper cleanup, reducing memory usage by 40%.",
      order_index: 7
    },
    {
      question_text: "What motivates you in your professional career?",
      question_type: "general",
      difficulty_level: "easy",
      suggested_answer: "I'm motivated by building products that solve real problems for users. There's nothing more satisfying than seeing positive user feedback or knowing that a feature I built is making someone's work easier. I also enjoy the continuous learning aspect of technology - every project teaches me something new, whether it's a different framework, architecture pattern, or business domain.",
      order_index: 8
    },
    {
      question_text: "Describe a situation where you had to learn a new technology or skill quickly.",
      question_type: "behavioral",
      difficulty_level: "medium",
      suggested_answer: "When our team decided to adopt TypeScript, I had only 2 weeks to become proficient before starting a major project. I dedicated time each day to hands-on practice, converted a personal project from JavaScript to TypeScript, and studied advanced concepts like generics and utility types. I also pair-programmed with a senior developer who had TypeScript experience. Within 2 weeks, I was comfortable writing type-safe code and even helped onboard other team members.",
      order_index: 9
    },
    {
      question_text: "Where do you see yourself professionally in the next 3-5 years?",
      question_type: "general",
      difficulty_level: "easy",
      suggested_answer: "I see myself growing into a senior developer role where I can mentor junior developers and contribute to architectural decisions. I want to deepen my expertise in system design and possibly move into a tech lead position. I'm particularly interested in learning more about distributed systems and cloud architecture. Long-term, I'd like to contribute to open-source projects and maybe speak at tech conferences about best practices I've learned.",
      order_index: 10
    }
  ];
}

function parseQuestionsFromAI(aiResponse) {
  try {
    console.log('Raw AI Response:', aiResponse); // Debug log
    
    // Try multiple approaches to extract JSON
    let jsonString = null;
    
    // Method 1: Look for JSON array
    let jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonString = jsonMatch[0];
    } else {
      // Method 2: Look for JSON between ```json blocks
      jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      } else {
        // Method 3: Look for JSON between ``` blocks
        jsonMatch = aiResponse.match(/```\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          jsonString = jsonMatch[1];
        }
      }
    }
    
    if (jsonString) {
      console.log('Extracted JSON:', jsonString); // Debug log
      const questionsArray = JSON.parse(jsonString);
      
      if (Array.isArray(questionsArray) && questionsArray.length > 0) {
        return questionsArray.map((q, index) => ({
          question_text: q.question || q.question_text,
          question_type: q.type || q.question_type || 'general',
          difficulty_level: q.difficulty || q.difficulty_level || 'medium',
          suggested_answer: q.answer || q.suggested_answer || 'Answer not provided',
          order_index: index + 1
        }));
      }
    }
    
    throw new Error('No valid JSON array found in response');
  } catch (error) {
    console.error('Error parsing AI response:', error);
    console.error('AI Response was:', aiResponse);
    // Create CV-specific fallback questions instead of generic ones
    return createGenericFallbackQuestions();
  }
}



async function saveQuestionsToDatabase(sessionId, questions) {
  return new Promise((resolve, reject) => {
    const values = questions.map(q => [
      sessionId,
      q.question_text,
      q.question_type,
      q.difficulty_level,
      q.suggested_answer,
      q.order_index
    ]);

    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const flatValues = values.flat();

    db.query(
      `INSERT INTO interview_questions (session_id, question_text, question_type, difficulty_level, suggested_answer, order_index) VALUES ${placeholders}`,
      flatValues,
      (err, result) => {
        if (err) reject(err);
        resolve(result);
      }
    );
  });
}

async function getQuestionsBySessionId(sessionId) {
  return new Promise((resolve, reject) => {
    db.query(
      'SELECT * FROM interview_questions WHERE session_id = ? ORDER BY order_index',
      [sessionId],
      (err, results) => {
        if (err) reject(err);
        resolve(results);
      }
    );
  });
}

async function getUserSessions(userId) {
  return new Promise((resolve, reject) => {
    db.query(
      `SELECT 
        s.*,
        COUNT(q.id) as question_count
       FROM interview_sessions s 
       LEFT JOIN interview_questions q ON s.id = q.session_id 
       WHERE s.user_id = ? 
       GROUP BY s.id 
       ORDER BY s.created_at DESC
      
       `,
      [userId],
      (err, results) => {
        if (err) reject(err);
        resolve(results);
      }
    );
  });
}

router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required for session deletion' 
      });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found. Please contact support to create an account.',
        code: 'USER_NOT_FOUND'
      });
    }

    const sessionExists = await verifySessionOwnership(sessionId, user.id);
    if (!sessionExists) {
      return res.status(404).json({ 
        success: false,
        error: 'Session not found or you do not have permission to delete it.',
        code: 'SESSION_NOT_FOUND'
      });
    }

    await deleteQuestionsBySessionId(sessionId);
    
    await deleteSessionById(sessionId);

    return res.json({
      success: true,
      message: 'Session deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting session:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to delete session',
      details: error.message 
    });
  }
});


async function verifySessionOwnership(sessionId, userId) {
  return new Promise((resolve, reject) => {
    db.query(
      'SELECT id FROM interview_sessions WHERE id = ? AND user_id = ?',
      [sessionId, userId],
      (err, results) => {
        if (err) reject(err);
        resolve(results.length > 0);
      }
    );
  });
}

async function deleteQuestionsBySessionId(sessionId) {
  return new Promise((resolve, reject) => {
    db.query(
      'DELETE FROM interview_questions WHERE session_id = ?',
      [sessionId],
      (err, result) => {
        if (err) reject(err);
        resolve(result);
      }
    );
  });
}

async function deleteSessionById(sessionId) {
  return new Promise((resolve, reject) => {
    db.query(
      'DELETE FROM interview_sessions WHERE id = ?',
      [sessionId],
      (err, result) => {
        if (err) reject(err);
        resolve(result);
      }
    );
  });
}



export default router