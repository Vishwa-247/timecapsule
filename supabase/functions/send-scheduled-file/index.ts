
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// Create a Supabase client with the Deno runtime
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Get the app URL (fallback for localhost development)
const APP_URL = Deno.env.get("APP_URL") || "https://timecapsule.vercel.app";

// Ensure Resend API key is available
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
console.log("RESEND_API_KEY exists:", !!RESEND_API_KEY);
if (!RESEND_API_KEY) {
  console.error("RESEND_API_KEY is not set in environment variables. Please add it to Supabase Secrets.");
}

/**
 * Send an email using Resend API
 */
async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  console.log(`SENDING EMAIL TO: ${to}`);
  console.log(`SUBJECT: ${subject}`);
  console.log(`BODY: ${body}`);
  console.log(`APP_URL being used: ${APP_URL}`);
  
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set in environment variables");
    return false;
  }
  
  console.log("RESEND_API_KEY exists (first 4 chars):", RESEND_API_KEY.substring(0, 4) + "...");
  
  try {
    // Make sure we have a valid email address
    if (!to || !to.includes('@')) {
      console.error("Invalid recipient email address:", to);
      return false;
    }

    console.log("Attempting to send email via Resend API...");
    
    const response = await callResendAPI(to, subject, body, RESEND_API_KEY);
    return response;
  } catch (error) {
    console.error("Exception during email sending:", error);
    return false;
  }
}

/**
 * Make the actual API call to Resend
 */
async function callResendAPI(to: string, subject: string, body: string, apiKey: string): Promise<boolean> {
  // Using Resend's default onboarding address (this works without domain verification)
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: "TimeCapsule <onboarding@resend.dev>",
      to: [to],
      subject: subject,
      html: body,
    })
  });
  
  // Log full response for debugging
  console.log("Resend API response status:", response.status);
  const responseText = await response.text();
  console.log("Resend API response body:", responseText);
  
  let result;
  try {
    result = JSON.parse(responseText);
  } catch (e) {
    console.error("Failed to parse response as JSON:", e);
    result = { error: "Failed to parse response" };
  }
  
  console.log("Email API parsed response:", JSON.stringify(result));
  
  if (!response.ok) {
    console.error("Email sending failed with status:", response.status);
    console.error("Error details:", JSON.stringify(result));
    return false;
  }
  
  console.log("Email sent successfully!");
  return true;
}

/**
 * Get files that are scheduled to be sent
 */
async function getScheduledFiles() {
  // Get current timestamp
  const now = new Date();
  console.log(`Current time: ${now.toISOString()}`);
  
  // Fetch files ready to be sent (scheduled_date <= now AND status = 'pending')
  const { data: files, error } = await supabase
    .from("scheduled_files")
    .select("*")
    .lte("scheduled_date", now.toISOString())
    .eq("status", "pending");
    
  if (error) {
    console.error("Error fetching scheduled files:", error);
    throw error;
  }
  
  console.log(`Found ${files?.length || 0} files to process`, files);
  return files || [];
}

/**
 * Generate access URL for a file
 */
function generateAccessUrl(accessToken: string): string {
  const baseUrl = APP_URL || "https://timecapsule.vercel.app";
  return `${baseUrl}/access/${accessToken}`;
}

/**
 * Update file status in database
 */
async function updateFileStatus(fileId: string, status: 'sent' | 'failed'): Promise<boolean> {
  const { error } = await supabase
    .from("scheduled_files")
    .update({ status })
    .eq("id", fileId);
    
  if (error) {
    console.error(`Error updating file status: ${error.message}`);
    return false;
  }
  
  return true;
}

/**
 * Process a single scheduled file
 */
async function processFile(file: any) {
  try {
    console.log(`Processing file: ${file.id} - ${file.file_name} to ${file.recipient_email}`);
    
    // Generate access URL
    const accessUrl = generateAccessUrl(file.access_token);
    console.log(`Generated access URL: ${accessUrl}`);
    
    // Prepare email content
    const subject = `Your scheduled file "${file.file_name}" is ready`;
    const body = `Hello,<br><br>Your scheduled file "${file.file_name}" is now available. Click the link below to access it:<br><br><a href="${accessUrl}">${accessUrl}</a><br><br>This link will expire in 24 hours.<br><br>Regards,<br>TimeCapsule Team`;
    
    // Send email with file access link
    const emailSent = await sendEmail(file.recipient_email, subject, body);
    
    if (emailSent) {
      // Update file status to 'sent'
      const updated = await updateFileStatus(file.id, 'sent');
      if (!updated) {
        return { id: file.id, success: false, error: "Failed to update file status" };
      }
      
      console.log(`File ${file.id} processed successfully`);
      return { id: file.id, success: true };
    } else {
      // Handle email sending failure
      await updateFileStatus(file.id, 'failed');
      console.error(`Failed to send email for file ${file.id}`);
      return { id: file.id, success: false, error: "Failed to send email" };
    }
  } catch (error) {
    console.error(`Error processing file ${file.id}:`, error);
    
    // Update file status to 'failed'
    try {
      await updateFileStatus(file.id, 'failed');
    } catch (updateError) {
      console.error(`Error updating file status to failed:`, updateError);
    }
    
    return { id: file.id, success: false, error: error.message || "Unknown error" };
  }
}

/**
 * Main function to process all scheduled files
 */
async function processScheduledFiles() {
  console.log("Processing scheduled files...");
  
  try {
    // Get files to process
    const files = await getScheduledFiles();
    
    if (files.length === 0) {
      return { processed: 0, message: "No files ready to be sent" };
    }
    
    // Process each file
    const results = await Promise.all(files.map(processFile));
    
    return {
      processed: results.length,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      details: results
    };
  } catch (error) {
    console.error("Error in processScheduledFiles:", error);
    throw error;
  }
}

/**
 * Handle request and response
 */
async function handleRequest(req: Request): Promise<Response> {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Running scheduled file sending process...");
    console.log("Environment check - APP_URL:", APP_URL);
    console.log("RESEND_API_KEY exists:", !!RESEND_API_KEY);
    
    const result = await processScheduledFiles();
    
    console.log("Processing complete. Result:", JSON.stringify(result));
    
    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json" 
        } 
      }
    );
  } catch (error) {
    console.error("Error in edge function:", error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message || "Unknown error occurred",
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json" 
        } 
      }
    );
  }
}

// Serve the edge function
serve(handleRequest);
