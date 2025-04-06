import { supabase } from "@/integrations/supabase/client";
import { FileItem } from "@/components/FileCard";
import { toast } from "sonner";

export interface ScheduleFileParams {
  file: File;
  recipient: string;
  scheduledDate: Date;
}

export interface UpdateScheduleParams {
  id: string;
  recipient: string;
  scheduledDate: Date;
}

export const uploadFile = async (file: File, userId: string): Promise<string> => {
  const fileExt = file.name.split(".").pop();
  const fileName = `${userId}/${Date.now()}.${fileExt}`;
  
  const { data, error } = await supabase
    .storage
    .from("timecapsule")
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false
    });
    
  if (error) {
    console.error("Error uploading file:", error);
    toast.error(`Failed to upload file: ${error.message}`);
    throw error;
  }
  
  return data.path;
};

export const getFilePreviewUrl = async (storagePath: string): Promise<string | null> => {
  if (!storagePath) return null;
  
  try {
    const { data, error } = await supabase
      .storage
      .from("timecapsule")
      .createSignedUrl(storagePath, 60 * 5); // 5 minutes
      
    if (error || !data) {
      console.error("Error creating signed URL for preview:", error);
      return null;
    }
    
    return data.signedUrl;
  } catch (error) {
    console.error("Error getting file preview URL:", error);
    return null;
  }
};

export const scheduleFile = async (params: ScheduleFileParams): Promise<void> => {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      toast.error("User not authenticated");
      throw new Error("User not authenticated");
    }
    
    const storagePath = await uploadFile(params.file, userData.user.id);
    const accessToken = crypto.randomUUID();
    
    const { error } = await supabase
      .from("scheduled_files")
      .insert({
        user_id: userData.user.id,
        file_name: params.file.name,
        file_size: params.file.size,
        file_type: params.file.type,
        storage_path: storagePath,
        recipient_email: params.recipient,
        scheduled_date: params.scheduledDate.toISOString(),
        access_token: accessToken,
      });
      
    if (error) {
      toast.error(`Failed to schedule file: ${error.message}`);
      throw error;
    }
    
    toast.success("File scheduled successfully");
    
    // Automatically trigger the file sending process to check if it should be sent immediately
    try {
      await triggerFileSending();
    } catch (triggerError) {
      console.log("Non-critical error when triggering file sending:", triggerError);
      // Non-critical error, don't rethrow
    }
  } catch (error: any) {
    console.error("Error scheduling file:", error);
    toast.error(`Error scheduling file: ${error.message}`);
    throw error;
  }
};

export const updateScheduledFile = async (params: UpdateScheduleParams): Promise<void> => {
  try {
    const { error } = await supabase
      .from("scheduled_files")
      .update({
        recipient_email: params.recipient,
        scheduled_date: params.scheduledDate.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.id);
      
    if (error) {
      toast.error(`Failed to update schedule: ${error.message}`);
      throw error;
    }
    
    toast.success("Schedule updated successfully");
  } catch (error: any) {
    console.error("Error updating scheduled file:", error);
    toast.error(`Error updating scheduled file: ${error.message}`);
    throw error;
  }
};

export const deleteScheduledFile = async (id: string): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from("scheduled_files")
      .select("storage_path")
      .eq("id", id)
      .single();
      
    if (error) {
      toast.error(`Failed to delete file: ${error.message}`);
      throw error;
    }
    
    const { error: storageError } = await supabase
      .storage
      .from("timecapsule")
      .remove([data.storage_path]);
      
    if (storageError) {
      console.error("Error removing file from storage:", storageError);
    }
    
    const { error: dbError } = await supabase
      .from("scheduled_files")
      .delete()
      .eq("id", id);
      
    if (dbError) {
      toast.error(`Failed to delete record: ${dbError.message}`);
      throw dbError;
    }
    
    toast.success("File deleted successfully");
  } catch (error: any) {
    console.error("Error deleting scheduled file:", error);
    toast.error(`Error deleting scheduled file: ${error.message}`);
    throw error;
  }
};

export const getScheduledFiles = async (): Promise<FileItem[]> => {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      toast.error("User not authenticated");
      return [];
    }

    const { data, error } = await supabase
      .from("scheduled_files")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false });
      
    if (error) {
      toast.error(`Failed to fetch files: ${error.message}`);
      throw error;
    }
    
    return data.map((item: any) => ({
      id: item.id,
      name: item.file_name,
      size: item.file_size,
      type: item.file_type,
      recipient: item.recipient_email,
      scheduledDate: new Date(item.scheduled_date),
      status: item.status as "pending" | "sent" | "failed",
      createdAt: new Date(item.created_at),
      access_token: item.access_token, // Include access_token for file previews
      storage_path: item.storage_path // Add storage path for previewing unsent files
    }));
  } catch (error: any) {
    console.error("Error fetching scheduled files:", error);
    toast.error(`Error fetching scheduled files: ${error.message}`);
    return [];
  }
};

export const getFileByToken = async (token: string): Promise<{
  fileName: string;
  fileType: string;
  fileUrl: string;
} | null> => {
  try {
    console.log("Fetching file with token:", token);
    
    const { data, error } = await supabase
      .from("scheduled_files")
      .select("*")
      .eq("access_token", token)
      .single();
      
    if (error || !data) {
      console.error("Error fetching file by token:", error);
      return null;
    }
    
    console.log("File data found in database:", data);
    
    // Update file status to 'sent' if it's still pending
    if (data.status === 'pending') {
      const { error: updateError } = await supabase
        .from("scheduled_files")
        .update({ 
          status: "sent",
          sent_at: new Date().toISOString() 
        })
        .eq("id", data.id);
      
      if (updateError) {
        console.error("Error updating file status:", updateError);
      }
    }
    
    const { data: fileData, error: fileError } = await supabase
      .storage
      .from("timecapsule")
      .createSignedUrl(data.storage_path, 60 * 60 * 24); // 24 hours
      
    if (fileError || !fileData) {
      console.error("Error creating signed URL:", fileError);
      return null;
    }
    
    console.log("Signed URL created successfully:", fileData.signedUrl);
    
    return {
      fileName: data.file_name,
      fileType: data.file_type,
      fileUrl: fileData.signedUrl
    };
  } catch (error: any) {
    console.error("Error in getFileByToken:", error);
    return null;
  }
};

export const getFilePreviewByStoragePath = async (storagePath: string): Promise<string | null> => {
  try {
    const { data, error } = await supabase
      .storage
      .from("timecapsule")
      .createSignedUrl(storagePath, 60 * 5); // 5 minutes expiry
      
    if (error) {
      console.error("Error creating signed URL for file preview:", error);
      return null;
    }
    
    return data?.signedUrl || null;
  } catch (error) {
    console.error("Error getting file preview by storage path:", error);
    return null;
  }
};

export const triggerFileSending = async (): Promise<any> => {
  try {
    toast.info("Triggering file sending...");
    
    // Using the Supabase URL from the client to construct the function URL
    const functionUrl = "https://limzhusojiirnsefkupe.supabase.co/functions/v1/send-scheduled-file";
    console.log("Calling function at URL:", functionUrl);
    
    const { data: authData } = await supabase.auth.getSession();
    const accessToken = authData.session?.access_token;
    
    // Make a direct fetch request to the function
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": accessToken ? `Bearer ${accessToken}` : "",
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response from send-scheduled-file:", errorText);
      throw new Error(`Failed to trigger file sending: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log("File sending result:", data);
    
    // Added a small delay to allow Supabase realtime to sync
    setTimeout(() => {
      if (data?.processed === 0) {
        toast.info("No files were ready to be sent at this time");
      } else if (data?.success > 0) {
        toast.success(`Successfully processed ${data.success} file(s)`);
        if (data?.failed > 0) {
          toast.error(`Failed to process ${data.failed} file(s)`);
        }
      } else {
        toast.info("No changes were made to any files");
      }
    }, 500);
    
    return data;
  } catch (error: any) {
    console.error("Error triggering file sending:", error);
    
    // Provide more descriptive error messages
    if (error.message?.includes("Failed to fetch") || 
        error.message?.includes("Network") ||
        error.message?.includes("CORS")) {
      toast.error("Cannot connect to the Edge Function. This is expected in the development environment unless you're running the Supabase Edge Functions locally.");
      console.log("To run Edge Functions locally, use: supabase functions serve");
    } else {
      toast.error(`Error triggering file sending: ${error.message || "Unknown error"}`);
    }
    
    throw error;
  }
};
