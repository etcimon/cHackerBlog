/**
 * Comment validation module with anti-spam, anti-abuse, and age verification.
 * Uses heuristic analysis and optional external API for spam detection.
 */

export interface ValidationResult {
  accepted: boolean;
  score: number; // 0-100, higher is better
  reasons: string[];
}

export interface CommentValidationInput {
  authorName: string;
  body: string;
  email?: string;
  ip: string;
  userAgent?: string;
  ageConfirmed?: boolean; // User confirms they are 14+
}

/**
 * Free spam detection API (StopForumSpam - free tier)
 * Returns spam probability based on IP, email, and username
 */
async function checkStopForumSpam(ip: string, email?: string, username?: string): Promise<number> {
  try {
    const params = new URLSearchParams();
    params.append('ip', ip);
    if (email) params.append('email', email);
    if (username) params.append('username', username);
    
    const response = await fetch(`https://api.stopforumspam.org/api?${params}&json`);
    const data = await response.json();
    
    if (data.success && data.ip) {
      // Return spam frequency (higher = more spammy)
      return data.ip.appears ? data.ip.frequency : 0;
    }
    
    return 0;
  } catch (error) {
    console.warn('StopForumSpam API check failed:', error);
    return 0; // Fail open - allow comment if API fails
  }
}

/**
 * Heuristic spam detection
 */
function heuristicSpamCheck(input: CommentValidationInput): { score: number; reasons: string[] } {
  let score = 100;
  const reasons: string[] = [];
  
  const { authorName, body, email } = input;
  
  // Check body length
  if (body.length < 5) {
    score -= 30;
    reasons.push('Comment too short');
  }
  
  if (body.length > 5000) {
    score -= 20;
    reasons.push('Comment excessively long');
  }
  
  // Check for excessive links
  const linkCount = (body.match(/https?:\/\//g) || []).length;
  if (linkCount > 3) {
    score -= 30;
    reasons.push('Too many links');
  }
  
  // Check for common spam patterns
  const spamPatterns = [
    /buy\s+(cheap|now)/i,
    /click\s+here/i,
    /free\s+(money|gift|trial)/i,
    /viagra|cialis|poker/i,
    /\$\$\$/g,
    /http:\/\/.*\.ru/i,
  ];
  
  for (const pattern of spamPatterns) {
    if (pattern.test(body)) {
      score -= 25;
      reasons.push('Matches spam pattern');
      break; // Only deduct once for pattern matching
    }
  }
  
  // Check for excessive capitalization
  const capsRatio = (body.match(/[A-Z]/g) || []).length / body.length;
  if (capsRatio > 0.5 && body.length > 20) {
    score -= 15;
    reasons.push('Excessive capitalization');
  }
  
  // Check for repeated characters
  if (/(.)\1{4,}/.test(body)) {
    score -= 20;
    reasons.push('Repeated characters');
  }
  
  // Check author name
  if (!authorName || authorName.trim().length < 2) {
    score -= 20;
    reasons.push('Invalid author name');
  }
  
  // Check email format if provided
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    score -= 15;
    reasons.push('Invalid email format');
  }
  
  return { score: Math.max(0, score), reasons };
}

/**
 * Main validation function
 */
export async function validateComment(input: CommentValidationInput): Promise<ValidationResult> {
  const reasons: string[] = [];
  let score = 100;
  
  // Age verification check
  if (!input.ageConfirmed) {
    return {
      accepted: false,
      score: 0,
      reasons: ['Age confirmation required (must be 14+)'],
    };
  }
  
  // Run heuristic checks
  const heuristicResult = heuristicSpamCheck(input);
  score = heuristicResult.score;
  reasons.push(...heuristicResult.reasons);
  
  // Check against external spam API (free tier)
  const spamScore = await checkStopForumSpam(input.ip, input.email, input.authorName);
  
  // If spam score is high (>5 appearances), significantly reduce acceptability
  if (spamScore > 5) {
    score -= 40;
    reasons.push(`High spam score from external API: ${spamScore}`);
  } else if (spamScore > 0) {
    score -= spamScore * 5; // Reduce score based on spam frequency
    reasons.push(`Moderate spam score from external API: ${spamScore}`);
  }
  
  // Final score calculation
  score = Math.max(0, Math.min(100, score));
  
  // Accept if score is above threshold
  const accepted = score >= 50;
  
  if (!accepted && reasons.length === 0) {
    reasons.push('Comment below acceptability threshold');
  }
  
  return {
    accepted,
    score,
    reasons,
  };
}

/**
 * Simple validation for quick checks (no external API)
 */
export function quickValidateComment(input: CommentValidationInput): ValidationResult {
  if (!input.ageConfirmed) {
    return {
      accepted: false,
      score: 0,
      reasons: ['Age confirmation required (must be 14+)'],
    };
  }
  
  const heuristicResult = heuristicSpamCheck(input);
  
  return {
    accepted: heuristicResult.score >= 50,
    score: heuristicResult.score,
    reasons: heuristicResult.reasons,
  };
}
