
import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { File, Download, ArrowLeft, Loader2, Shield, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getFileByToken, initializeSocket } from "@/services/fileService";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

const FileAccess = () => {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [fileData, setFileData] = useState<{
    fileName: string;
    fileType: string;
    fileUrl: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { theme } = useTheme();
  const isMobile = useIsMobile();

  // Initialize Socket.io connection on component mount
  useEffect(() => {
    const setupSocket = async () => {
      try {
        await initializeSocket();
        console.log("Socket.io initialized in FileAccess");
      } catch (err) {
        console.error("Failed to initialize Socket.io:", err);
        // Non-critical error, continue loading the file
      }
    };
    
    setupSocket();
  }, []);

  useEffect(() => {
    const fetchFile = async () => {
      try {
        if (!token) {
          setError("Invalid file link");
          setLoading(false);
          return;
        }

        console.log("Fetching file with token:", token);
        const data = await getFileByToken(token);
        
        if (!data) {
          console.error("File data not found for token:", token);
          setError("File not found or access has expired");
        } else {
          console.log("File data retrieved:", data);
          setFileData(data);
          // Verify the URL is valid
          if (!data.fileUrl || !data.fileUrl.startsWith('http')) {
            console.error("Invalid file URL:", data.fileUrl);
            setError("Invalid file access URL. Please contact support.");
          }
        }
      } catch (err: any) {
        console.error("Error fetching file:", err);
        setError(`An error occurred while retrieving the file: ${err.message || 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    };

    fetchFile();
  }, [token]);

  const getFileIcon = () => {
    if (!fileData) return null;
    
    if (fileData.fileType.includes("image")) {
      return (
        <div className="w-full max-w-md rounded-lg overflow-hidden shadow-lg mb-6">
          <img 
            src={fileData.fileUrl} 
            alt={fileData.fileName} 
            className="w-full h-auto"
            onError={() => toast.error("Error loading image preview")}
          />
        </div>
      );
    }
    
    return (
      <div className="w-32 h-32 bg-primary/10 rounded-lg flex items-center justify-center mb-6">
        <File className="h-16 w-16 text-primary" />
      </div>
    );
  };

  const handleDownload = () => {
    if (!fileData) return;
    
    // Create an invisible anchor element for more reliable downloads
    const link = document.createElement('a');
    link.href = fileData.fileUrl;
    link.download = fileData.fileName; // Set the filename for the download
    link.target = "_blank"; // Open in new tab as fallback
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    
    try {
      link.click(); // Trigger the download
      toast.success("File download started");
    } catch (err) {
      console.error("Error starting download:", err);
      // Fallback for devices that don't support the download attribute
      window.open(fileData.fileUrl, '_blank');
      toast.success("File opened in new tab");
    } finally {
      // Clean up
      document.body.removeChild(link);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Link to="/" className="text-xl font-medium flex items-center space-x-2">
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              TimeCapsule
            </span>
          </Link>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto text-center">
          <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary mb-8">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to home
          </Link>
          
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 text-primary animate-spin mb-4" />
              <p className="text-foreground">Loading your file...</p>
            </div>
          ) : error ? (
            <div className="py-12 border border-dashed rounded-xl bg-background text-foreground">
              <h2 className="text-2xl font-bold mb-4 text-foreground">Oops! {error}</h2>
              <p className="text-muted-foreground mb-6">
                The file you're looking for may have been removed or the link has expired.
              </p>
              <Button asChild>
                <Link to="/">Go to Home</Link>
              </Button>
            </div>
          ) : (
            <div className="py-12">
              <div className="mb-6 text-primary flex items-center justify-center">
                <Shield className="h-6 w-6 mr-2" />
                <span className="text-sm font-medium">Secure File Access</span>
              </div>
              
              <h2 className="text-2xl font-bold mb-2 text-foreground">Your file is ready!</h2>
              <p className="text-muted-foreground mb-8">
                You can now view or download the file.
              </p>
              
              <div className="flex flex-col items-center">
                {getFileIcon()}
                
                <h3 className="text-xl font-semibold mb-2 text-foreground">{fileData?.fileName}</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  {fileData?.fileType}
                </p>
                
                {/* Primary download button */}
                <Button onClick={handleDownload} size="lg" className="mb-4">
                  <Download className="mr-2 h-5 w-5" />
                  Download File
                </Button>
                
                {/* Alternative direct link for mobile */}
                {isMobile && fileData && (
                  <div className="mt-4 w-full max-w-md">
                    <p className="text-sm text-muted-foreground mb-2">
                      If the download doesn't start automatically:
                    </p>
                    <Button variant="outline" asChild className="w-full">
                      <a 
                        href={fileData.fileUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center justify-center"
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open Directly
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default FileAccess;
