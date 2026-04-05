const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  UnderlineType,
} = require("docx");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middleware ----------
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(req, file, cb) {
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || [".pdf", ".docx", ".txt"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, DOCX, and TXT files are allowed"));
    }
  },
});

// ---------- Text extraction ----------
async function extractText(buffer, mimetype, originalname) {
  const ext = path.extname(originalname).toLowerCase();

  if (ext === ".txt" || mimetype === "text/plain") {
    return buffer.toString("utf-8");
  }

  if (ext === ".pdf" || mimetype === "application/pdf") {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (
    ext === ".docx" ||
    mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new Error("Unsupported file format");
}

// ---------- DOCX generation ----------
function buildDocxFromOptimized(optimized) {
  const children = [];

  const hr = () =>
    new Paragraph({
      border: { bottom: { color: "999999", space: 1, style: BorderStyle.SINGLE, size: 6 } },
      spacing: { after: 120 },
    });

  const heading = (text, level = HeadingLevel.HEADING_2) =>
    new Paragraph({
      text: text.toUpperCase(),
      heading: level,
      spacing: { before: 240, after: 80 },
      border: { bottom: { color: "1a73e8", style: BorderStyle.SINGLE, size: 12, space: 1 } },
    });

  const bullet = (text) =>
    new Paragraph({
      bullet: { level: 0 },
      children: [new TextRun({ text, size: 22 })],
      spacing: { after: 60 },
    });

  const plain = (text, bold = false, size = 22) =>
    new Paragraph({
      children: [new TextRun({ text, bold, size })],
      spacing: { after: 60 },
    });

  // Name
  if (optimized.name) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: optimized.name, bold: true, size: 40 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
      })
    );
  }

  // Contact
  if (optimized.contact) {
    const contactParts = [
      optimized.contact.email,
      optimized.contact.phone,
      optimized.contact.location,
      optimized.contact.linkedin,
      optimized.contact.github,
      optimized.contact.website,
    ]
      .filter(Boolean)
      .join("  |  ");

    children.push(
      new Paragraph({
        children: [new TextRun({ text: contactParts, size: 20, color: "555555" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
      })
    );
  }

  // Summary
  if (optimized.summary) {
    children.push(heading("Professional Summary"));
    children.push(plain(optimized.summary));
  }

  // Experience
  if (optimized.experience && optimized.experience.length > 0) {
    children.push(heading("Work Experience"));
    for (const exp of optimized.experience) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: exp.title || "", bold: true, size: 24 }),
            new TextRun({ text: exp.company ? `  —  ${exp.company}` : "", size: 24, color: "1a73e8" }),
          ],
          spacing: { before: 160, after: 40 },
        })
      );
      if (exp.dates || exp.location) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: [exp.dates, exp.location].filter(Boolean).join("  |  "),
                size: 20,
                color: "666666",
                italics: true,
              }),
            ],
            spacing: { after: 60 },
          })
        );
      }
      if (exp.bullets && exp.bullets.length > 0) {
        exp.bullets.forEach((b) => children.push(bullet(b)));
      }
    }
  }

  // Skills
  if (optimized.skills && optimized.skills.length > 0) {
    children.push(heading("Skills"));
    const skillsText = Array.isArray(optimized.skills[0])
      ? optimized.skills.map((g) => `${g.category}: ${g.items.join(", ")}`).join("\n")
      : optimized.skills.join("  •  ");
    children.push(plain(skillsText));
  }

  // Education
  if (optimized.education && optimized.education.length > 0) {
    children.push(heading("Education"));
    for (const edu of optimized.education) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: edu.degree || "", bold: true, size: 24 }),
            new TextRun({ text: edu.institution ? `  —  ${edu.institution}` : "", size: 24 }),
          ],
          spacing: { before: 120, after: 40 },
        })
      );
      if (edu.dates || edu.gpa) {
        children.push(
          plain([edu.dates, edu.gpa ? `GPA: ${edu.gpa}` : ""].filter(Boolean).join("  |  "))
        );
      }
    }
  }

  // Projects
  if (optimized.projects && optimized.projects.length > 0) {
    children.push(heading("Projects"));
    for (const proj of optimized.projects) {
      children.push(plain(proj.name || "", true));
      if (proj.description) children.push(plain(proj.description));
      if (proj.bullets) proj.bullets.forEach((b) => children.push(bullet(b)));
    }
  }

  // Certifications
  if (optimized.certifications && optimized.certifications.length > 0) {
    children.push(heading("Certifications"));
    optimized.certifications.forEach((c) =>
      children.push(bullet(typeof c === "string" ? c : `${c.name}${c.issuer ? ` — ${c.issuer}` : ""}${c.date ? ` (${c.date})` : ""}`))
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: { margin: { top: 720, right: 900, bottom: 720, left: 900 } },
        },
        children,
      },
    ],
    styles: {
      paragraphStyles: [
        {
          id: "Heading2",
          name: "Heading 2",
          run: { bold: true, size: 24, color: "222222" },
        },
      ],
    },
  });

  return Packer.toBuffer(doc);
}

// ---------- Routes ----------

// Parse resume file
app.post("/api/parse-resume", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const text = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
    res.json({ text: text.trim() });
  } catch (err) {
    console.error("Parse error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Optimize resume — streaming SSE
app.post("/api/optimize", async (req, res) => {
  const { jobDescription, resumeText } = req.body;

  if (!jobDescription?.trim() || !resumeText?.trim()) {
    return res.status(400).json({ error: "Both job description and resume text are required" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(401).json({ error: "No API key configured. Set ANTHROPIC_API_KEY in .env or provide via X-Api-Key header." });
  }

  const client = new Anthropic({ apiKey });

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const SYSTEM_PROMPT = `You are an expert resume writer and ATS (Applicant Tracking System) specialist with 15+ years of experience. Your role is to:
1. Analyze job descriptions to extract critical keywords, required skills, seniority signals, and responsibilities
2. Rewrite resumes to maximize ATS compatibility and human readability
3. Quantify achievements wherever possible using metrics (%, $, #, time saved, etc.)
4. Maintain complete truthfulness — never fabricate experience, skills, or credentials
5. Follow ATS-friendly formatting: no tables, standard section headings, clean structure

You always respond with a single valid JSON object — no markdown fences, no explanation outside the JSON.`;

  const USER_PROMPT = `Analyze this job description and resume, then produce an optimized resume.

=== JOB DESCRIPTION ===
${jobDescription}

=== CURRENT RESUME ===
${resumeText}

Return a JSON object with EXACTLY this structure (all fields are required; use null for missing info):
{
  "ats_score": <integer 0-100>,
  "keyword_match_percent": <integer 0-100>,
  "matched_keywords": [<string>, ...],
  "missing_keywords": [<string>, ...],
  "improvement_suggestions": [<string>, ...],
  "seniority_level": "<junior|mid|senior|lead|executive>",
  "changes_summary": [<string describing each major change made>, ...],
  "optimized_resume": {
    "name": "<full name>",
    "contact": {
      "email": "<email or null>",
      "phone": "<phone or null>",
      "location": "<city, state or null>",
      "linkedin": "<url or null>",
      "github": "<url or null>",
      "website": "<url or null>"
    },
    "summary": "<2-4 sentence professional summary tailored to the role>",
    "experience": [
      {
        "title": "<job title>",
        "company": "<company name>",
        "dates": "<start – end>",
        "location": "<city, state or null>",
        "bullets": ["<strong action-verb bullet with metrics>", ...]
      }
    ],
    "skills": [
      { "category": "<category name>", "items": ["<skill>", ...] }
    ],
    "education": [
      {
        "degree": "<degree name>",
        "institution": "<school name>",
        "dates": "<graduation year or range>",
        "gpa": "<GPA or null>"
      }
    ],
    "projects": [
      {
        "name": "<project name>",
        "description": "<one-line description>",
        "bullets": ["<achievement or feature>", ...]
      }
    ],
    "certifications": [
      { "name": "<cert name>", "issuer": "<issuer or null>", "date": "<year or null>" }
    ]
  }
}

Rules:
- ATS score reflects keyword density, formatting, and relevance to this specific job
- Rewrite bullet points to start with strong action verbs and include metrics where inferable
- Add missing but clearly inferable keywords naturally (do not fabricate them)
- Keep resume to 1-2 pages worth of content
- Remove irrelevant experience sections for this role
- Order sections: Summary → Experience → Skills → Education → Projects → Certifications`;

  try {
    send("status", { message: "Analyzing job description and resume..." });

    let fullText = "";

    const stream = client.messages.stream({
      model: "claude-opus-4-6",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: USER_PROMPT }],
    });

    stream.on("text", (delta) => {
      fullText += delta;
      send("chunk", { delta });
    });

    const finalMsg = await stream.finalMessage();

    // Parse JSON from response
    let result;
    try {
      // Strip potential markdown fences
      const cleaned = fullText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      result = JSON.parse(cleaned);
    } catch {
      // Try extracting JSON block
      const match = fullText.match(/\{[\s\S]*\}/);
      if (match) {
        result = JSON.parse(match[0]);
      } else {
        throw new Error("Could not parse JSON from model response");
      }
    }

    send("done", { result });
    res.end();
  } catch (err) {
    console.error("Optimize error:", err);
    send("error", { message: err.message });
    res.end();
  }
});

// Export as DOCX
app.post("/api/export/docx", async (req, res) => {
  try {
    const { optimized } = req.body;
    if (!optimized) return res.status(400).json({ error: "Missing optimized resume data" });

    const buffer = await buildDocxFromOptimized(optimized);
    const filename = `${(optimized.name || "Resume").replace(/\s+/g, "_")}_Optimized.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("DOCX export error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Export as PDF
app.post("/api/export/pdf", async (req, res) => {
  try {
    const { optimized, name } = req.body;
    if (!optimized) return res.status(400).json({ error: "Missing optimized resume data" });

    const htmlPdf = require("html-pdf-node");

    const html = buildResumeHtml(optimized);
    const file = { content: html };
    const options = {
      format: "A4",
      margin: { top: "16mm", right: "16mm", bottom: "16mm", left: "16mm" },
      printBackground: true,
    };

    const buffer = await htmlPdf.generatePdf(file, options);
    const filename = `${(name || optimized.name || "Resume").replace(/\s+/g, "_")}_Optimized.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("PDF export error:", err);
    res.status(500).json({ error: err.message });
  }
});

function buildResumeHtml(opt) {
  const esc = (s) => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  let body = "";

  if (opt.name) body += `<h1>${esc(opt.name)}</h1>`;

  if (opt.contact) {
    const parts = [opt.contact.email, opt.contact.phone, opt.contact.location, opt.contact.linkedin, opt.contact.github, opt.contact.website].filter(Boolean);
    if (parts.length) body += `<p class="contact">${parts.map(esc).join(" &nbsp;|&nbsp; ")}</p>`;
  }

  if (opt.summary) {
    body += `<div class="section"><div class="section-title">Professional Summary</div><p>${esc(opt.summary)}</p></div>`;
  }

  if (opt.experience?.length) {
    body += `<div class="section"><div class="section-title">Work Experience</div>`;
    for (const exp of opt.experience) {
      body += `<div class="job">
        <div class="job-header"><span class="job-title">${esc(exp.title)}</span><span class="job-dates">${esc(exp.dates || "")}</span></div>
        <div class="job-company">${esc(exp.company || "")}${exp.location ? " &middot; " + esc(exp.location) : ""}</div>`;
      if (exp.bullets?.length) body += `<ul>${exp.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>`;
      body += `</div>`;
    }
    body += `</div>`;
  }

  if (opt.skills?.length) {
    body += `<div class="section"><div class="section-title">Skills</div>`;
    if (typeof opt.skills[0] === "object" && opt.skills[0].category) {
      for (const sg of opt.skills) {
        body += `<p><strong>${esc(sg.category)}:</strong> ${(sg.items || []).map(esc).join(", ")}</p>`;
      }
    } else {
      body += `<p>${opt.skills.map(esc).join(" &bull; ")}</p>`;
    }
    body += `</div>`;
  }

  if (opt.education?.length) {
    body += `<div class="section"><div class="section-title">Education</div>`;
    for (const edu of opt.education) {
      body += `<div class="job">
        <div class="job-header"><span class="job-title">${esc(edu.degree)}</span><span class="job-dates">${esc(edu.dates || "")}</span></div>
        <div class="job-company">${esc(edu.institution || "")}${edu.gpa ? " &middot; GPA: " + esc(edu.gpa) : ""}</div>
      </div>`;
    }
    body += `</div>`;
  }

  if (opt.projects?.length) {
    body += `<div class="section"><div class="section-title">Projects</div>`;
    for (const proj of opt.projects) {
      body += `<div class="job"><strong>${esc(proj.name || "")}</strong>${proj.description ? " — " + esc(proj.description) : ""}`;
      if (proj.bullets?.length) body += `<ul>${proj.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>`;
      body += `</div>`;
    }
    body += `</div>`;
  }

  if (opt.certifications?.length) {
    body += `<div class="section"><div class="section-title">Certifications</div><ul>`;
    for (const c of opt.certifications) {
      const text = typeof c === "string" ? c : `${c.name}${c.issuer ? " — " + c.issuer : ""}${c.date ? " (" + c.date + ")" : ""}`;
      body += `<li>${esc(text)}</li>`;
    }
    body += `</ul></div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body { font-family: 'Arial', sans-serif; font-size: 11pt; color: #222; line-height: 1.5; }
    h1 { font-size: 20pt; font-weight: 700; text-align: center; margin-bottom: 4px; }
    .contact { text-align: center; color: #555; font-size: 9.5pt; margin-bottom: 18px; }
    .section { margin-bottom: 14px; }
    .section-title { font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1a73e8; border-bottom: 1.5px solid #1a73e8; padding-bottom: 2px; margin-bottom: 8px; }
    .job { margin-bottom: 10px; }
    .job-header { display: flex; justify-content: space-between; }
    .job-title { font-weight: 700; font-size: 10.5pt; }
    .job-dates { font-size: 9.5pt; color: #555; }
    .job-company { font-style: italic; color: #555; font-size: 9.5pt; margin-bottom: 4px; }
    ul { padding-left: 18px; margin: 4px 0; }
    li { margin-bottom: 2px; font-size: 10pt; }
    p { margin: 3px 0; font-size: 10pt; }
  </style></head><body>${body}</body></html>`;
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Resume Optimizer Agent running at http://0.0.0.0:${PORT}`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://<your-ip>:${PORT}`);
  console.log(`   API key: ${process.env.ANTHROPIC_API_KEY ? "✅ Configured" : "❌ Not set (set ANTHROPIC_API_KEY in .env)"}\n`);
});
