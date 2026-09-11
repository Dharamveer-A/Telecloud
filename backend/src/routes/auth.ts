import { Router } from "express";
import jwt from "jsonwebtoken";
import { requestLoginCode, submitLoginCode, submitLoginPassword } from "../telegram/client";

const router = Router();

router.post("/request-code", async (req, res) => {
  const { phone } = req.body; // e.g. "+15551234567"
  if (!phone) return res.status(400).json({ error: "phone is required" });
  try {
    await requestLoginCode(phone);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Failed to send code" });
  }
});

router.post("/verify-code", async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: "phone and code are required" });
  try {
    const result = await submitLoginCode(phone, code);
    if (result.status === "need_password") {
      return res.json({ status: "need_password" });
    }
    const token = jwt.sign({ userId: result.userId }, process.env.JWT_SECRET!, { expiresIn: "30d" });
    res.json({ status: "ok", token });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Invalid code" });
  }
});

router.post("/verify-password", async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: "phone and password are required" });
  try {
    const result = await submitLoginPassword(phone, password);
    const token = jwt.sign({ userId: (result as any).userId }, process.env.JWT_SECRET!, { expiresIn: "30d" });
    res.json({ status: "ok", token });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Invalid password" });
  }
});

export default router;
