import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';

dotenv.config();

const router = express.Router();  
const genAI = new GoogleGenerativeAI(process.env.GEMENI_API_KEY);

function cleanJsonResponse(text) {
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  cleaned = cleaned.trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

async function retryApiCall(apiCall, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall();
    } catch (error) {
      console.log(`API call failed (attempt ${i + 1}/${maxRetries}):`, error.message);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
}

async function extractCVDetails(cvText) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  
  const prompt = `
  Analyze this CV/resume comprehensively for ALL industries and job types.
  Extract information for ANY profession: healthcare, finance, education, retail, hospitality, construction, legal, creative, etc.
  
  Return ONLY valid JSON with this structure:
  
  {
    "skills": ["skill1", "skill2", "skill3"],
    "experienceYears": 0,
    "jobTitles": ["title1", "title2"],
    "industries": ["industry1", "industry2"],
    "education": "education level",
    "searchKeywords": ["optimized", "search", "terms"]
  }
  
  Make sure searchKeywords contains 5-8 optimized terms for job searching.
  
  CV Text:
  ${cvText.substring(0, 5000)}
  `;

  try {
    const result = await retryApiCall(async () => {
      const response = await model.generateContent(prompt);
      return response.response;
    });
    
    const text = result.text();
    const cleanedText = cleanJsonResponse(text);
    console.log("CV analysis:", cleanedText);
    
    const details = JSON.parse(cleanedText);
    
    return {
      skills: Array.isArray(details.skills) ? details.skills : [],
      experienceYears: typeof details.experienceYears === 'number' ? details.experienceYears : 0,
      jobTitles: Array.isArray(details.jobTitles) ? details.jobTitles : [],
      industries: Array.isArray(details.industries) ? details.industries : [],
      education: details.education || 'Not specified',
      searchKeywords: Array.isArray(details.searchKeywords) ? details.searchKeywords : []
    };
  } catch (error) {
    console.error("Error extracting CV details:", error);
    return {
      skills: [], 
      experienceYears: 0, 
      jobTitles: [], 
      industries: [],
      education: 'Not specified', 
      searchKeywords: []
    };
  }
}

function formatDate(dateString) {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 14) return '1 week ago';
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  } catch (error) {
    return 'Recently';
  }
}

function extractSkillsFromDescription(description) {
  const commonSkills = [
    'JavaScript', 'Python', 'Java', 'React', 'Node.js', 'SQL', 'HTML', 'CSS',
    'Project Management', 'Communication', 'Leadership', 'Problem Solving',
    'Excel', 'PowerPoint', 'Salesforce', 'CRM', 'Marketing', 'Sales',
    'Customer Service', 'Data Analysis', 'Machine Learning', 'AI',
    'Nursing', 'Healthcare', 'Finance', 'Accounting', 'Legal', 'Education'
  ];
  
  const foundSkills = commonSkills.filter(skill => 
    description.toLowerCase().includes(skill.toLowerCase())
  );
  
  return foundSkills.slice(0, 8); 
}

function calculateRelevanceScore(job, cvDetails) {
  let score = 0;
  let maxPossibleScore = 0;
  
  if (job.requiredSkills && job.requiredSkills.length > 0 && cvDetails.skills && cvDetails.skills.length > 0) {
    const matchedSkills = cvDetails.skills.filter(skill =>
      job.requiredSkills.some(reqSkill =>
        reqSkill.toLowerCase().includes(skill.toLowerCase()) ||
        skill.toLowerCase().includes(reqSkill.toLowerCase())
      )
    );
    const skillMatchPercentage = matchedSkills.length / Math.max(job.requiredSkills.length, 1);
    score += skillMatchPercentage * 40;
    maxPossibleScore += 40;
  }
  
  if (cvDetails.jobTitles && cvDetails.jobTitles.length > 0) {
    let titleMatch = 0;
    cvDetails.jobTitles.forEach(title => {
      if (job.title && job.title.toLowerCase().includes(title.toLowerCase())) {
        titleMatch = Math.max(titleMatch, 30); // Max 30 points for title match
      }
    });
    score += titleMatch;
    maxPossibleScore += 30;
  }
  
  const jobText = `${job.title} ${job.description}`.toLowerCase();
  let experiencePenalty = 0;
  
  if (jobText.includes('senior') || jobText.includes('lead') || jobText.includes('manager')) {
    if (cvDetails.experienceYears < 3) {
      experiencePenalty = -15; // Penalty for applying to senior roles with low experience
    }
  }
  
  const yearMatches = jobText.match(/(\d+)\+?\s*years?/g);
  if (yearMatches) {
    yearMatches.forEach(match => {
      const requiredYears = parseInt(match.match(/\d+/)[0]);
      if (requiredYears > cvDetails.experienceYears + 1) { 
        experiencePenalty = Math.min(experiencePenalty - 10, -20); 
      }
    });
  }
  
  score += experiencePenalty;
  maxPossibleScore += 20;
  
  if (cvDetails.searchKeywords && cvDetails.searchKeywords.length > 0) {
    let keywordMatches = 0;
    cvDetails.searchKeywords.forEach(keyword => {
      if (jobText.includes(keyword.toLowerCase())) {
        keywordMatches++;
      }
    });
    const keywordScore = (keywordMatches / cvDetails.searchKeywords.length) * 10;
    score += keywordScore;
    maxPossibleScore += 10;
  }
  
  const finalScore = maxPossibleScore > 0 ? Math.max(0, (score / maxPossibleScore) * 100) : 0;
  return Math.round(finalScore);
}

async function searchJobs(keywords, location, limit = 20) {
  try {
    const cleanKeywords = keywords.split(' ').slice(0, 3).join(' ');
    
    const searchQuery = location ? 
      `${cleanKeywords} ${location}` : 
      cleanKeywords;

    const options = {
      method: 'GET',
      url: 'https://jsearch.p.rapidapi.com/search',
      params: {
        query: searchQuery,
        page: '1',
        num_pages: '1',
        country: 'US'
      },
      headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
      }
    };

    console.log('Job search params:', { query: searchQuery, location });

    const response = await axios.request(options);
    
    if (!response.data || !response.data.data) {
      console.log('API response structure:', response.data);
      return [];
    }

    const jobs = response.data.data || [];
    
    return jobs
      .slice(0, limit)
      .map(job => ({
        title: job.job_title || 'No title',
        company: job.employer_name || 'Unknown Company',
        location: job.job_city && job.job_state ? 
          `${job.job_city}, ${job.job_state}` : 
          job.job_country || 'Not specified',
        type: job.job_employment_type || 'Full-time',
        platform: 'Job Search',
        posted: job.job_posted_at_datetime_utc ? 
          formatDate(job.job_posted_at_datetime_utc) : 'Recently',
        description: job.job_description ? 
          job.job_description.substring(0, 300) + '...' : 
          'No description available',
        salary: job.job_salary_currency && job.job_min_salary ? 
          `${job.job_salary_currency} ${job.job_min_salary}${job.job_max_salary ? ` - ${job.job_max_salary}` : ''}` : 
          'Not specified',
        url: job.job_apply_link || '#',
        requiredSkills: extractSkillsFromDescription(job.job_description || ''),
        jobId: job.job_id || Date.now().toString() + Math.random()
      }));
  } catch (error) {
    console.error("Job search error:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    return [];
  }
}

function applyLocationFilter(jobs, location) {
  if (!location || location.trim() === '') return jobs;
  
  const loc = location.toLowerCase().trim();
  
  return jobs.filter(job => {
    const jobLocation = (job.location || '').toLowerCase();
    
    
    return (
      jobLocation.includes(loc) || 
      jobLocation.includes('remote') || 
      jobLocation.includes('anywhere') ||
      jobLocation.includes('worldwide')
    );
  });
}

async function searchAllJobs(cvDetails, location) {
  const topSkills = cvDetails.skills.slice(0, 2);
  const topJobTitle = cvDetails.jobTitles.slice(0, 1);
  const topKeywords = cvDetails.searchKeywords.slice(0, 2);
  
  const searchTerms = [
    ...topKeywords,
    ...topSkills,
    ...topJobTitle
  ].filter(term => term && term.trim()).slice(0, 3);
  
  const searchQuery = searchTerms.join(' ');
  
  console.log(`Searching for: "${searchQuery}" in "${location || 'all locations'}"`);
  
  if (!process.env.RAPIDAPI_KEY) {
    console.error('RAPIDAPI_KEY is not set');
    return [];
  }
  
  let jobs = await searchJobs(searchQuery, location, 30);
  console.log(`Found ${jobs.length} jobs before location filtering`);
  
  if (location && location.trim()) {
    jobs = applyLocationFilter(jobs, location);
    console.log(`After location filtering: ${jobs.length} jobs`);
  }
  
  const uniqueJobs = jobs.filter((job, index, self) => 
    index === self.findIndex(j => 
      j.title.toLowerCase().trim() === job.title.toLowerCase().trim() && 
      j.company.toLowerCase().trim() === job.company.toLowerCase().trim()
    )
  );
  
  console.log(`Total unique jobs found: ${uniqueJobs.length}`);
  return uniqueJobs;
}

async function fallbackSearch(cvDetails, location) {
  console.log('Attempting fallback search...');
  
  try {
    const primaryKeyword = cvDetails.jobTitles[0] || cvDetails.skills[0] || 'jobs';
    
    const options = {
      method: 'GET',
      url: 'https://jsearch.p.rapidapi.com/search',
      params: {
        query: primaryKeyword,
        page: '1',
        num_pages: '1'
      },
      headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
      }
    };

    const response = await axios.request(options);
    
    if (response.data && response.data.data) {
      let jobs = response.data.data.slice(0, 15).map(job => ({
        title: job.job_title || 'No title',
        company: job.employer_name || 'Unknown Company',
        location: job.job_city && job.job_state ? 
          `${job.job_city}, ${job.job_state}` : 'Not specified',
        type: job.job_employment_type || 'Full-time',
        platform: 'Job Search',
        posted: 'Recently',
        description: job.job_description ? 
          job.job_description.substring(0, 300) + '...' : 
          'No description available',
        salary: 'Not specified',
        url: job.job_apply_link || '#',
        requiredSkills: extractSkillsFromDescription(job.job_description || ''),
        jobId: job.job_id || Date.now().toString() + Math.random()
      }));
      
      if (location && location.trim()) {
        jobs = applyLocationFilter(jobs, location);
      }
      
      return jobs;
    }
    
    return [];
  } catch (error) {
    console.error('Fallback search failed:', error.message);
    return [];
  }
}

router.post('/search-with-cv', async (req, res) => {
  const { cvText, location = '' } = req.body;

  if (!cvText || cvText.trim().length < 50) {
    return res.status(400).json({ 
      success: false,
      error: 'CV text must be at least 50 characters',
      code: 'INVALID_INPUT',
      suggestion: 'Please paste your complete CV/resume text'
    });
  }

  try {
    const cvDetails = await extractCVDetails(cvText);
    console.log('CV Analysis Completed:', {
      skills: cvDetails.skills.length,
      experience: cvDetails.experienceYears,
      jobTitles: cvDetails.jobTitles.length
    });

    let jobs = await searchAllJobs(cvDetails, location);
    console.log(`Job search results: ${jobs.length} jobs found`);

    if (jobs.length === 0) {
      jobs = await fallbackSearch(cvDetails, location);
      console.log(`Fallback results: ${jobs.length} jobs found`);
    }

    const processedJobs = jobs
      .map(job => ({
        ...job,
        relevanceScore: calculateRelevanceScore(job, cvDetails)
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 25); 
    const response = {
      success: true,
      jobs: processedJobs.map(job => ({
        title: job.title,
        company: job.company,
        location: job.location,
        type: job.type,
        platform: job.platform,
        posted: job.posted,
        description: job.description,
        salary: job.salary,
        url: job.url,
        requiredSkills: job.requiredSkills,
        jobId: job.jobId,
        relevanceScore: job.relevanceScore || 0 
      })),
      cvDetails: {
        skills: cvDetails.skills.slice(0, 15),
        experienceYears: cvDetails.experienceYears,
        jobTitles: cvDetails.jobTitles.slice(0, 5),
        industries: cvDetails.industries.slice(0, 3),
        education: cvDetails.education
      },
      searchSummary: {
        returnedJobs: processedJobs.length,
        searchLocation: location || 'All locations',
        averageRelevanceScore: processedJobs.length > 0 
          ? parseFloat((processedJobs.reduce((sum, job) => sum + job.relevanceScore, 0) / processedJobs.length).toFixed(1))
          : 0
      }
    };

    console.log(`Search completed successfully. Returning ${response.jobs.length} jobs`);
    return res.json(response);

  } catch (error) {
    console.error('Search Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process your request',
      code: 'SERVER_ERROR',
      suggestion: 'Please try again later or check your network connection'
    });
  }
});

export default router;