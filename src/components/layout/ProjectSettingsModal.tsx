import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { FileAttachment, Project } from '../../types';
import { useStore } from '../../store';
import { formatFileSize } from '../../utils/files';

interface ProjectSettingsModalProps {
  isOpen: boolean;
  project: Project | null;
  onClose: () => void;
}

export function ProjectSettingsModal({
  isOpen,
  project,
  onClose,
}: ProjectSettingsModalProps) {
  const updateProject = useStore((state) => state.updateProject);
  const deleteProject = useStore((state) => state.deleteProject);
  const registerFileHandle = useStore((state) => state.registerFileHandle);
  const addToast = useStore((state) => state.addToast);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [customProfile, setCustomProfile] = useState('');
  const [customResponseStyle, setCustomResponseStyle] = useState('');
  const [attachments, setAttachments] = useState<Array<FileAttachment & { file?: File }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !project) return;
    setName(project.name);
    setDescription(project.description || '');
    setCustomProfile(project.customProfile || '');
    setCustomResponseStyle(project.customResponseStyle || '');
    setAttachments(project.attachments || []);
  }, [isOpen, project]);

  if (!isOpen || !project) return null;

  const handleSave = () => {
    updateProject(project.id, {
      name: name.trim() || project.name,
      description: description.trim() || undefined,
      customProfile: customProfile.trim() || undefined,
      customResponseStyle: customResponseStyle.trim() || undefined,
      attachments,
    });
    addToast({
      type: 'success',
      title: 'Project updated',
      message: 'Project settings saved.',
    });
    onClose();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this project?')) return;
    await deleteProject(project.id);
    addToast({
      type: 'success',
      title: 'Project deleted',
      message: 'Project removed successfully.',
    });
    onClose();
  };

  const handleAttachFiles = async () => {
    const openPicker = (window as Window & {
      showOpenFilePicker?: (options?: {
        multiple?: boolean;
        excludeAcceptAllOption?: boolean;
        types?: Array<{
          description?: string;
          accept: Record<string, string[]>;
        }>;
      }) => Promise<FileSystemFileHandle[]>;
    }).showOpenFilePicker;

    if (!openPicker) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const handles = await openPicker({
        multiple: true,
        excludeAcceptAllOption: false,
      });

      const next: FileAttachment[] = [];
      for (const handle of handles) {
        const file = await handle.getFile();
        const id = uuidv4();
        await registerFileHandle({
          id,
          handle,
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          createdAt: Date.now(),
        });

        next.push({
          id,
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          source: 'handle',
          handleId: id,
        });
      }

      if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
    } catch (error) {
      const errorName = (error as Error).name;
      if (errorName === 'AbortError') return;
      // Fallback for browsers without File System Access API support.
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      const next = files.map((file) => ({
        id: uuidv4(),
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        source: 'memory' as const,
        file,
      }));
      setAttachments((prev) => [...prev, ...next]);
    }
    event.target.value = '';
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      data-testid="project-settings-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Project Settings
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{project.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            Close
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Project instructions (context)
            </label>
            <textarea
              value={customProfile}
              onChange={(e) => setCustomProfile(e.target.value)}
              rows={4}
              placeholder="Domain specifics, goals, constraints."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Project response style
            </label>
            <textarea
              value={customResponseStyle}
              onChange={(e) => setCustomResponseStyle(e.target.value)}
              rows={3}
              placeholder="Tone, structure, formatting."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                Project files
              </label>
              <button
                type="button"
                onClick={handleAttachFiles}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                Attach files
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            {attachments.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                No files attached.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs text-gray-600 dark:text-gray-200"
                  >
                    <div>
                      <div className="font-medium">{attachment.name}</div>
                      <div className="text-gray-400 dark:text-gray-500">{formatFileSize(attachment.size)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(attachment.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <button
            type="button"
            onClick={handleDelete}
            className="text-sm text-red-600 hover:text-red-700"
          >
            Delete Project
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm text-gray-600 dark:text-gray-200 hover:text-gray-800 dark:hover:text-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-black"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
