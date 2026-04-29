import { useState, useMemo, useRef, useCallback } from 'react';
import { SelectedTarget, FeedbackMessage } from '../types';

export type PdfArtifactViewKey =
  | 'clean'
  | 'docData'
  | 'editedJson'
  | 'upgradedJson'
  | 'textFinderArtifact'
  | 'blockFinderArtifact'
  | 'blockExtractorArtifact';

export const useArtifacts = () => {
  // Main document data and drafts
  const [docData, setDocData] = useState<any>(null);
  const [jsonDraft, setJsonDraft] = useState('');
  const extractedJsonRef = useRef<any | null>(null);
  const workflowJsonRef = useRef<any | null>(null);

  // Results from specific actions
  const [editedJson, setEditedJson] = useState<any | null>(null);
  const [hasEditedJson, setHasEditedJson] = useState(false);
  const [upgradedJson, setUpgradedJson] = useState<any | null>(null);
  
  const [textFinderArtifact, setTextFinderArtifact] = useState<any | null>(null);
  const [textFinderFoundArtifact, setTextFinderFoundArtifact] = useState<any | null>(null);
  const [blockFinderArtifact, setBlockFinderArtifact] = useState<any | null>(null);
  const [blockFinderFoundArtifact, setBlockFinderFoundArtifact] = useState<any | null>(null);
  const [blockExtractorArtifact, setBlockExtractorArtifact] = useState<any | null>(null);

  // Active PDF visualization artifact
  const [activePdfArtifact, setActivePdfArtifact] = useState<PdfArtifactViewKey>('clean');

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

  const getExtractedJsonArtifact = useCallback(() => {
    if (extractedJsonRef.current) return extractedJsonRef.current;
    return docData;
  }, [docData]);

  const getArtifactByKey = useCallback((key: PdfArtifactViewKey) => {
    switch (key) {
      case 'clean':
        return null;
      case 'docData': return docData;
      case 'editedJson': return editedJson;
      case 'upgradedJson': return upgradedJson;
      case 'textFinderArtifact': return textFinderArtifact;
      case 'blockFinderArtifact': return blockFinderArtifact;
      case 'blockExtractorArtifact': return blockExtractorArtifact;
      default:
        return getWorkflowJsonArtifact();
    }
  }, [docData, editedJson, upgradedJson, textFinderArtifact, blockFinderArtifact, blockExtractorArtifact, getWorkflowJsonArtifact]);

  const getActivePdfArtifact = useCallback(() => getArtifactByKey(activePdfArtifact), [activePdfArtifact, getArtifactByKey]);

  const setActivePdfArtifactAndResetSelection = useCallback((key: PdfArtifactViewKey) => {
    setActivePdfArtifact(key);
    setSelectedTarget(null);
    setSelectedContent('');
  }, []);

  const resetArtifacts = useCallback(() => {
    setDocData(null);
    setJsonDraft('');
    extractedJsonRef.current = null;
    workflowJsonRef.current = null;
    setEditedJson(null);
    setHasEditedJson(false);
    setUpgradedJson(null);
    setTextFinderArtifact(null);
    setBlockFinderArtifact(null);
    setBlockExtractorArtifact(null);
    setActivePdfArtifact('clean');
    setSelectedTarget(null);
    setSelectedContent('');
  }, []);

  return {
    docData, setDocData,
    jsonDraft, setJsonDraft,
    extractedJsonRef,
    workflowJsonRef,
    editedJson, setEditedJson,
    hasEditedJson, setHasEditedJson,
    upgradedJson, setUpgradedJson,
    textFinderArtifact, setTextFinderArtifact,
    textFinderFoundArtifact, setTextFinderFoundArtifact,
    blockFinderArtifact, setBlockFinderArtifact,
    blockFinderFoundArtifact, setBlockFinderFoundArtifact,
    blockExtractorArtifact, setBlockExtractorArtifact,
    activePdfArtifact, setActivePdfArtifact: setActivePdfArtifactAndResetSelection,
    getActivePdfArtifact,
    selectedTarget, setSelectedTarget,
    selectedContent, setSelectedContent,
    outputFolderHandle, setOutputFolderHandle,
    outputFolderName, setOutputFolderName,
    editorFeedback, setEditorFeedback,
    exportFeedback, setExportFeedback,
    parsedData,
    getExtractedJsonArtifact,
    getWorkflowJsonArtifact,
    resetArtifacts
  };
};