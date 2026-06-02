# Resume Skill Matcher

> AI-powered resume optimization agent — paste a job description, get a tailored resume with matched skills and suggested improvements.

## What it does
- Parses your base resume and a target job description
- Uses Claude AI to identify skill gaps and keyword matches
- Rewrites/optimizes resume sections for ATS and recruiter impact
- Provides a match score with improvement suggestions
- Web UI for easy upload and download

## Tech Stack
| Layer | Technology |
|---|---|
| Runtime | Node.js |
| AI | Claude (Anthropic) |
| Backend | Express.js |
| Frontend | Vanilla JS + HTML |
| Deploy | Render (`render.yaml`) |

## Quick Start
```bash
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env
npm install
node server.js
```
Open `http://localhost:3000`

## Project Structure
```
├── server.js          # Express API server
├── public/            # Frontend (upload UI, results display)
├── .last-optimized.json  # Cached last optimization result
├── render.yaml        # Render.com deployment
└── package.json
```

## Environment Variables
```
ANTHROPIC_API_KEY=
```

## Status
🚧 Active development
