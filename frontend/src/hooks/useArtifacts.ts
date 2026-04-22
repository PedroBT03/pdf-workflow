import { useState, useMemo, useRef, useCallback } from 'react';
import { SelectedTarget, FeedbackMessage } from '../types';

export const useArtifacts = () => {
  // Main document data and drafts
  const [docData, setDocData] = useState<any>(null);
  const [jsonDraft, setJsonDraft] = useState('');
  const workflowJsonRef = useRef<any | null>(null);

  // Results from specific actions
  const [editedJson, setEditedJson] = useState<any | null>(null);
  const [hasEditedJson, setHasEditedJson] = useState(false);
  const [upgradedJson, setUpgradedJson] = useState<any | null>(null);
  
  const [textFinderArtifact, setTextFinderArtifact] = useState<any | null>(null);
  const [textFinderFoundArtifact, setTextFinderFoundArtifact] = useState<any | null>(null);
  const [blockFinderArtifact, setBlockFinderArtifact] = useState<any | null>(null);
  const [blockFinderFoundArtifact, setBlockFinderFoundArtifact] = useState<any | null>(null);

  // Editor selection
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>(null);
  const [selectedContent, setSelectedContent] = useState('');

  // Export and folder handles
  const [outputFolderHandle, setOutputFolderHandle] = useState<any | null>(null);
  const [outputFolderName, setOutputFolderName] = useState<string>('No folder selected');

  // Panel-specific feedback messages
  const [editorFeedback, setEditorFeedback] = useState<FeedbackMessage | null>(null);
  const [exportFeedback, setExportFeedback] = useState<FeedbackMessage | null>(null);

  // Memo: Automatically parse the draft for visual validation.
  const parsedData = useMemo(() => {
    if (!jsonDraft.trim()) return null;
    try {
      return JSON.parse(jsonDraft);
    } catch {
      return null;
    }
  }, [jsonDraft]);

  // Helper to obtain the latest available JSON artifact.
  const getWorkflowJsonArtifact = useCallback(() => {
    if (workflowJsonRef.current) return workflowJsonRef.current;
    if (parsedData) return parsedData;
    if (editedJson) return editedJson;
    return docData;
  }, [parsedData, editedJson, docData]);

  const resetArtifacts = useCallback(() => {
    setDocData(null);
    setJsonDraft('');
    workflowJsonRef.current = null;
    setEditedJson(null);
    setHasEditedJson(false);
    setUpgradedJson(null);
    setTextFinderArtifact(null);
    setBlockFinderArtifact(null);
    setSelectedTarget(null);
    setSelectedContent('');
  }, []);

  return {
    docData, setDocData,
    jsonDraft, setJsonDraft,
    workflowJsonRef,
    editedJson, setEditedJson,
    hasEditedJson, setHasEditedJson,
    upgradedJson, setUpgradedJson,
    textFinderArtifact, setTextFinderArtifact,
    textFinderFoundArtifact, setTextFinderFoundArtifact,
    blockFinderArtifact, setBlockFinderArtifact,
    blockFinderFoundArtifact, setBlockFinderFoundArtifact,
    selectedTarget, setSelectedTarget,
    selectedContent, setSelectedContent,
    outputFolderHandle, setOutputFolderHandle,
    outputFolderName, setOutputFolderName,
    editorFeedback, setEditorFeedback,
    exportFeedback, setExportFeedback,
    parsedData,
    getWorkflowJsonArtifact,
    resetArtifacts
  };
};