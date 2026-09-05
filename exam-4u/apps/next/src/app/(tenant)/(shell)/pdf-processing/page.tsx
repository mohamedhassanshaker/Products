'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Box, Button, Heading, Stack, Table, Text } from '@chakra-ui/react';
import * as pdfProcessingApi from '@/lib/tenant-console/pdf-processing-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';

/**
 * PDF upload + session-list screen (migration plan Phase 6, sub-slice "6a", `/pdf-processing`) — ported
 * flow from legacy's `PdfUploadComponent`/`PdfSessionListComponent`-equivalent surface, trimmed to this
 * sub-slice's own scope: a drag-and-drop PDF upload (no `contentTypeHint`/`subjectId`/`curriculumId`
 * fields exposed in the UI this sub-slice — the classification step always runs, matching the simplest
 * "just upload a PDF and let the pipeline classify it" flow; those optional fields remain reachable via
 * the API directly for a later sub-slice's more advanced upload form) and a list of this tenant's
 * sessions, each linking to its own status-poll detail screen.
 *
 * Gated by `pdf.upload` (upload) / `pdf.review` (list) — matches the nav item's own gate exactly.
 */
export default function PdfProcessingPage() {
  const { hasPermission } = useTenantAuthContext();
  if (!hasPermission('pdf.upload')) {
    return (
      <Box>
        <Heading size="md" mb="2">
          PDF Import
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }
  return <PdfProcessingAuthorized />;
}

function PdfProcessingAuthorized() {
  const router = useRouter();
  const { hasPermission } = useTenantAuthContext();
  const canReview = hasPermission('pdf.review');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const [sessions, setSessions] = useState<pdfProcessingApi.PdfProcessingSessionSummary[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  useEffect(() => {
    if (!canReview) {
      setSessionsLoaded(true);
      return;
    }
    pdfProcessingApi
      .listSessions()
      .then((rows) => {
        setSessions(rows);
        setSessionsLoaded(true);
      })
      .catch(() => setSessionsLoaded(true));
  }, [canReview]);

  function setFileFromInput(candidate: File | undefined) {
    if (!candidate) return;
    setFileError(null);
    setFile(candidate);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    setFileFromInput(e.dataTransfer.files?.[0]);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFileFromInput(e.target.files?.[0]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBannerMessage(null);
    setFileError(null);
    if (!file) {
      setFileError('Choose a PDF file to upload.');
      return;
    }
    if (uploading) return;

    setUploading(true);
    try {
      const result = await pdfProcessingApi.uploadPdf(file);
      router.push(`/pdf-processing/${result.sessionId}`);
    } catch (err) {
      setUploading(false);
      handleUploadError(err);
    }
  }

  /** Per-code error copy — same upload-validation vocabulary FR-PDF-1 shares with FR-CUR-2's own
   * document-upload rejections. */
  function handleUploadError(err: unknown) {
    if (!isTenantApiError(err)) {
      setBannerMessage('Something went wrong while uploading this PDF. Please try again.');
      return;
    }
    switch (err.code) {
      case 'INVALID_FILE_SIGNATURE':
        setFileError('This file is not a genuine PDF. Choose a real PDF file.');
        return;
      case 'INVALID_EXTENSION':
        setFileError('Only .pdf files are accepted.');
        return;
      case 'EMPTY_FILE':
        setFileError('The selected file is empty.');
        return;
      case 'FILE_TOO_LARGE':
        setFileError('This PDF is too large. Choose a smaller file.');
        return;
      default:
        setBannerMessage(err.message || 'Something went wrong while uploading this PDF. Please try again.');
    }
  }

  return (
    <Box maxW="900px">
      <Heading size="md" mb="4">
        PDF Import
      </Heading>

      {bannerMessage && (
        <Box role="alert" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3" fontSize="sm" mb="4" tabIndex={-1}>
          {bannerMessage}
        </Box>
      )}

      <Box as="form" onSubmit={handleSubmit} mb="8">
        <Text fontWeight="semibold" mb="2">
          Upload a PDF
        </Text>
        <Box
          borderWidth="2px"
          borderStyle="dashed"
          borderColor={isDragging ? 'brand.500' : 'gray.300'}
          borderRadius="md"
          p="6"
          textAlign="center"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            data-testid="pdf-file-input"
          />
          {file ? (
            <Stack direction="row" justify="center" align="center" gap="2" mt="2">
              <Text>
                {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
              </Text>
              <Button size="sm" variant="ghost" type="button" onClick={() => setFile(null)}>
                Change file
              </Button>
            </Stack>
          ) : (
            <Text color="gray.600" mt="2">
              Drag and drop a PDF file here, or use the field above to browse.
            </Text>
          )}
        </Box>
        {fileError && (
          <Text color="red.fg" fontSize="sm" mt="1">
            {fileError}
          </Text>
        )}

        <Button type="submit" colorPalette="brand" mt="4" loading={uploading} loadingText="Uploading…">
          Upload PDF
        </Button>
      </Box>

      {canReview && (
        <>
          <Heading size="sm" mb="2">
            Your uploads
          </Heading>
          {!sessionsLoaded ? (
            <Box h="20" bg="gray.100" borderRadius="md" />
          ) : sessions.length === 0 ? (
            <Text color="gray.600">No PDFs have been uploaded yet.</Text>
          ) : (
            <Table.Root data-testid="pdf-sessions-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>File</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                  <Table.ColumnHeader>Uploaded</Table.ColumnHeader>
                  <Table.ColumnHeader />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {sessions.map((session) => (
                  <Table.Row key={session.id}>
                    <Table.Cell>{session.sourceFileName}</Table.Cell>
                    <Table.Cell>{session.status}</Table.Cell>
                    <Table.Cell>{new Date(session.createdAt).toLocaleString()}</Table.Cell>
                    <Table.Cell>
                      <Link href={`/pdf-processing/${session.id}`}>
                        <Text as="span" color="brand.fg">
                          View
                        </Text>
                      </Link>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </>
      )}
    </Box>
  );
}
