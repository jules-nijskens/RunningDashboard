import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function GET() {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/['"]/g, "");
  console.log("TEST ROUTE - Key length:", apiKey.length);
  
  if (!apiKey) {
    return NextResponse.json({ error: "No API Key" }, { status: 500 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  try {
    console.log("TEST ROUTE - Sending 'ping' to Gemini...");
    const result = await model.generateContent("Say 'Next.js Connection Successful'");
    const response = await result.response;
    return NextResponse.json({ 
      success: true, 
      message: response.text(),
      keyLength: apiKey.length 
    });
  } catch (error: any) {
    console.error("TEST ROUTE - Failure:");
    console.dir(error, { depth: null });
    return NextResponse.json({ 
      success: false, 
      status: error.status,
      message: error.message 
    }, { status: 500 });
  }
}
