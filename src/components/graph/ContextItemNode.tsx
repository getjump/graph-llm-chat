import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useStore } from '../../store';
import type { ContextSettings } from '../../types';

interface ContextItemNodeProps {
  data: {
    title: string;
    description?: string;
    enabled: boolean;
    badge?: string;
    details?: string[];
    conversationId: string;
    settingKey?: keyof ContextSettings;
  };
}

function ContextItemNodeComponent({ data }: ContextItemNodeProps) {
  const { title, description, enabled, badge, details, conversationId, settingKey } = data;
  const updateConversation = useStore((state) => state.updateConversation);
  const conversation = useStore((state) => state.conversations.get(conversationId));
  const canToggle = Boolean(settingKey && conversation);

  return (
    <div
      className={`min-w-[220px] max-w-[280px] rounded-lg border-2 shadow-sm px-3 py-2 bg-white dark:bg-gray-900 ${
        enabled
          ? 'border-emerald-400/70'
          : 'border-gray-200 dark:border-gray-700 opacity-70'
      }`}
    >
      <Handle
        type="source"
        position={Position.Right}
        className="w-2.5 h-2.5 bg-emerald-500 border-2 border-white"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
          {title}
        </div>
        {badge && (
          <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {badge}
          </span>
        )}
      </div>

      {description && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
          {description}
        </div>
      )}

      {details && details.length > 0 && (
        <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 space-y-1">
          {details.map((detail) => (
            <div key={detail} className="truncate">
              {detail}
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          {enabled ? 'Included' : 'Excluded'}
        </span>
        {canToggle ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              const contextSettings = conversation?.contextSettings ?? {};
              const current = settingKey ? contextSettings[settingKey] ?? true : true;
              if (!settingKey) return;
              updateConversation(conversationId, {
                contextSettings: {
                  ...contextSettings,
                  [settingKey]: !current,
                },
              });
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            className={`nodrag nopan text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
              enabled
                ? 'border-emerald-400 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'
                : 'border-gray-300 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            {enabled ? 'Disable' : 'Enable'}
          </button>
        ) : (
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Info</span>
        )}
      </div>
    </div>
  );
}

export const ContextItemNode = memo(ContextItemNodeComponent);
