import React, { useState } from 'react';

interface UploadProps {
  onUploadSuccess: (data: any) => void;
}

// Render a file input that uploads a PDF and returns parsed backend output.
export const FileUploader = ({ onUploadSuccess }: UploadProps) => {
  const [loading, setLoading] = useState(false);

  // Upload the selected PDF to the backend and return parsed metadata.
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8000/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      const data = await response.json();
      onUploadSuccess(data);
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Failed to upload and process PDF.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-10 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
      <h2 className="text-xl font-semibold mb-4">Upload PDF for Extraction</h2>
      <input 
        type="file" 
        accept=".pdf" 
        onChange={handleFileChange} 
        disabled={loading}
        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
      />
      {loading && <p className="mt-4 text-blue-600 animate-pulse">Running pdf2data parser...</p>}
    </div>
  );
};