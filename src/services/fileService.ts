import { supabase } from "@/integrations/supabase/client";
import { FileItem } from "@/components/FileCard";
import { toast } from "@/hooks/use-toast";

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
    toast({
      variant: "destructive",
      title: "Upload Error",
      description: `Failed to upload file: ${error.message}`,
      duration: 3000
    });
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
      toast({
        variant: "destructive",
        title: "Auth Error",
        description: "User not authenticated",
        duration: 3000
      });
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
        status: "pending", // explicitly set status
      });
      
    if (error) {
      toast({
        variant: "destructive",
        title: "Error", 
        description: `Failed to schedule: ${error.message}`,
        duration: 3000
      });
      throw error;
    }
    
    toast({
      title: "Success",
      description: "File scheduled successfully",
      duration: 2000
    });
    
    // Check if recipient is using a verified domain in development
    if (import.meta.env.DEV || import.meta.env.MODE === 'development') {
      // Show a notice about Resend limitations in development
      toast({
        title: "Free Tier Notice",
        description: "With free tier, emails only go to verified addresses",
        duration: 3000
      });
    }
    
    // Automatically trigger the file sending process if it should be sent immediately
    const now = new Date();
    if (params.scheduledDate <= now) {
      try {
        await triggerFileSending();
      } catch (triggerError) {
        console.log("Non-critical error when triggering immediate file sending:", triggerError);
        // Non-critical error, don't rethrow
      }
    }
  } catch (error: any) {
    console.error("Error scheduling file:", error);
    toast({
      variant: "destructive",
      title: "Schedule Error",
      description: `Error: ${error.message}`,
      duration: 3000
    });
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
      toast({
        variant: "destructive",
        title: "Update Error",
        description: `Failed: ${error.message}`,
        duration: 3000
      });
      throw error;
    }
    
    toast({
      title: "Success",
      description: "Schedule updated",
      duration: 2000
    });
    
    // Check if the updated date is now or in the past, if so trigger sending
    const now = new Date();
    if (params.scheduledDate <= now) {
      try {
        await triggerFileSending();
      } catch (triggerError) {
        console.log("Non-critical error when triggering file sending after update:", triggerError);
      }
    }
  } catch (error: any) {
    console.error("Error updating scheduled file:", error);
    toast({
      variant: "destructive",
      title: "Update Error",
      description: `Error: ${error.message}`,
      duration: 3000
    });
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
      toast({
        variant: "destructive",
        title: "Delete Error",
        description: `Failed to delete file: ${error.message}`,
        duration: 3000
      });
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
      toast({
        variant: "destructive",
        title: "Delete Error",
        description: `Failed to delete record: ${dbError.message}`,
        duration: 3000
      });
      throw dbError;
    }
    
    toast({
      title: "Success",
      description: "File deleted successfully",
      duration: 3000
    });
  } catch (error: any) {
    console.error("Error deleting scheduled file:", error);
    toast({
      variant: "destructive",
      title: "Delete Error",
      description: `Error deleting scheduled file: ${error.message}`,
      duration: 3000
    });
    throw error;
  }
};

export const getScheduledFiles = async (): Promise<FileItem[]> => {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      toast({
        variant: "destructive",
        title: "Authentication Error",
        description: "User not authenticated",
        duration: 3000
      });
      return [];
    }

    const { data, error } = await supabase
      .from("scheduled_files")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false });
      
    if (error) {
      toast({
        variant: "destructive",
        title: "Fetch Error",
        description: `Failed to fetch files: ${error.message}`,
        duration: 3000
      });
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
    toast({
      variant: "destructive",
      title: "Fetch Error",
      description: `Error fetching scheduled files: ${error.message}`,
      duration: 3000
    });
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
    
    // Get a signed URL for the file regardless of status
    const { data: fileData, error: fileError } = await supabase
      .storage
      .from("timecapsule")
      .createSignedUrl(data.storage_path, 60 * 60 * 24); // 24 hours
      
    if (fileError || !fileData) {
      console.error("Error creating signed URL:", fileError);
      return null;
    }
    
    console.log("Signed URL created successfully:", fileData.signedUrl);
    
    // If file was pending, try to update status to 'sent'
    if (data.status === 'pending') {
      try {
        const { error: updateError } = await supabase
          .from("scheduled_files")
          .update({ 
            status: "sent",
            sent_at: new Date().toISOString() 
          })
          .eq("id", data.id);
        
        if (updateError) {
          console.error("Error updating file status:", updateError);
          // Continue anyway, the user should still be able to access the file
        } else {
          console.log("Updated file status to 'sent'");
        }
      } catch (updateErr) {
        console.error("Exception updating file status:", updateErr);
        // Continue anyway
      }
    }
    
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
    toast({
      title: "Processing",
      description: "Sending files...",
      duration: 2000
    });
    
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
      throw new Error(`Failed to trigger: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log("File sending result:", data);
    
    // Add a longer delay to allow database updates to sync
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Force refresh the file list to show updated statuses
    window.dispatchEvent(new CustomEvent('refresh-file-list'));
    
    // Now show toast messages with the results
    if (data?.processed === 0) {
      toast({
        title: "No Files to Send",
        description: "No files ready to be sent at this time",
        duration: 2000
      });
    } else if (data?.success > 0) {
      toast({
        title: "Success",
        description: `Sent ${data.success} file(s)`,
        duration: 2000
      });
      
      // If using Resend free tier and some files failed, explain the limitations
      if (data?.failed > 0) {
        toast({
          title: "Free Tier Notice",
          description: "Some emails failed - verify recipient emails",
          duration: 3000
        });
      }
    } else if (data?.failed > 0) {
      toast({
        variant: "destructive", 
        title: "Error",
        description: `Failed to send ${data.failed} file(s)`,
        duration: 2000
      });
    } else {
      toast({
        title: "No Changes",
        description: "No changes made to any files",
        duration: 2000
      });
    }
    
    return data;
  } catch (error: any) {
    console.error("Error triggering file sending:", error);
    
    // Provide more descriptive error messages
    if (error.message?.includes("Failed to fetch") || 
        error.message?.includes("Network") ||
        error.message?.includes("CORS")) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Cannot connect to the server",
        duration: 2000
      });
    } else {
      toast({
        variant: "destructive",
        title: "Error",
        description: `${error.message || "Unknown error"}`,
        duration: 2000
      });
    }
    
    throw error;
  }
};
