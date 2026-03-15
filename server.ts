import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Twilio Client Initialization
const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return null;
  }
  return twilio(accountSid, authToken);
};

// API Route for sending SMS
app.post("/api/send-sms", async (req, res) => {
  const { recipient, message } = req.body;
  const client = getTwilioClient();
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!client || !from) {
    return res.status(500).json({ 
      error: "Twilio is not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in environment variables." 
    });
  }

  try {
    const result = await client.messages.create({
      body: message,
      from: from,
      to: recipient,
    });
    res.json({ success: true, sid: result.sid });
  } catch (error: any) {
    console.error("Twilio Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// API Route for bulk SMS
app.post("/api/send-bulk-sms", async (req, res) => {
  const { recipients, message } = req.body;
  const client = getTwilioClient();
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!client || !from) {
    return res.status(500).json({ error: "Twilio is not configured." });
  }

  const results = [];
  for (const recipient of recipients) {
    try {
      const result = await client.messages.create({
        body: message,
        from: from,
        to: recipient,
      });
      results.push({ recipient, success: true, sid: result.sid });
    } catch (error: any) {
      results.push({ recipient, success: false, error: error.message });
    }
  }
  res.json({ results });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
