import express from 'express';
import { Router } from 'express';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

const genAI = new GoogleGenerativeAI(process.env.GEMENI_API_KEY);

router.post('/analyze', async (req, res) => {
  try {
    const { cvText } = req.body;

    if (!cvText) {
      return res.status(400).json({
        success: false,
        message: 'CV text is required'
      });
    }

    if (!process.env.GEMENI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'Google API key not configured'
      });
    }

    const analysisPrompt = `
      Analyze the following CV and provide detailed feedback. Please respond in JSON format with the following structure:
      {
        "overallGrade": "A/B/C/D/F",
        "score": number (0-100),
        "strengths": ["strength1", "strength2", ...],
        "errors": [
          {
            "category": "Grammar/Formatting/Content/Structure",
            "issue": "description of the issue",
            "suggestion": "how to fix it",
            "severity": "High/Medium/Low"
          }
        ],
        "recommendations": ["recommendation1", "recommendation2", ...],
        "summary": "Overall summary of the CV quality"
      }

      CV Content:
      ${cvText}
    `;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(analysisPrompt);
    const analysisText = result.response.text();

    let analysis;
    try {
      const cleanedText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      analysis = {
        overallGrade: "C",
        score: 75,
        strengths: ["Experience listed", "Contact information provided"],
        errors: [
          {
            category: "Content",
            issue: "Analysis could not be fully processed",
            suggestion: "Please try again with a clearer CV format",
            severity: "Medium"
          }
        ],
        recommendations: ["Consider reformatting your CV", "Add more specific achievements"],
        summary: "CV analysis completed with partial results"
      };
    }

    res.json({
      success: true,
      analysis: analysis
    });

  } catch (error) {
    console.error('CV Analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze CV: ' + error.message
    });
  }
});

router.post('/enhance', async (req, res) => {
  try {
    const { originalCv, selectedErrors } = req.body;

    if (!originalCv || !selectedErrors) {
      return res.status(400).json({
        success: false,
        message: 'Original CV and selected errors are required'
      });
    }

    const enhancementPrompt = `
      Please enhance the following CV by fixing these specific issues:
      
      Issues to fix:
      ${selectedErrors.map(error => `- ${error.issue}: ${error.suggestion}`).join('\n')}
      
      Original CV:
      ${originalCv}
      
      Please provide an enhanced version that addresses these issues while maintaining the original content and style. Return only the enhanced CV text without any additional formatting or explanations.
    `;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(enhancementPrompt);
    const enhancedCv = result.response.text();

    res.json({
      success: true,
      enhancedCv: enhancedCv
    });

  } catch (error) {
    console.error('CV Enhancement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to enhance CV: ' + error.message
    });
  }
});

router.post('/export-text', async (req, res) => {
  try {
    const { cvText } = req.body;

    if (!cvText) {
      return res.status(400).json({
        success: false,
        message: 'CV text is required'
      });
    }

    res.json({
      success: true,
      cvText: cvText
    });

  } catch (error) {
    console.error('Text Export error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export text: ' + error.message
    });
  }
});



export default router;