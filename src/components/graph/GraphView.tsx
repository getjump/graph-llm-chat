import { useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useStore } from '../../store';
import { ConversationNode } from './ConversationNode';
import { GraphControls } from './GraphControls';
import type { ContextSettings } from '../../types';
import type { ConversationNode as ConversationNodeType } from '../../types';
import { ContextItemNode } from './ContextItemNode';
import { estimateContextExtraTokens } from '../../utils/tokenBudget';

interface ConversationNodeData {
  node: ConversationNodeType;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeTypes: any = {
  conversation: ConversationNode,
  contextItem: ContextItemNode,
};

export function GraphView() {
  const storeNodes = useStore((state) => state.nodes);
  const storeEdges = useStore((state) => state.edges);
  const activeConversationId = useStore((state) => state.activeConversationId);
  const conversations = useStore((state) => state.conversations);
  const projects = useStore((state) => state.projects);
  const customProfile = useStore((state) => state.customProfile);
  const customResponseStyle = useStore((state) => state.customResponseStyle);
  const toolSettings = useStore((state) => state.toolSettings);
  const memorySettings = useStore((state) => state.memorySettings);
  const memoryRetrievalByConversation = useStore(
    (state) => state.memoryRetrievalByConversation
  );
  const updateNodePosition = useStore((state) => state.updateNodePosition);
  const createEdge = useStore((state) => state.createEdge);
  const canCreateEdge = useStore((state) => state.canCreateEdge);
  const autoLayoutNodes = useStore((state) => state.autoLayoutNodes);
  const theme = useStore((state) => state.theme);

  // Convert store nodes to React Flow nodes
  const baseNodes = useMemo(() => {
    if (!activeConversationId) return [];

    return Array.from(storeNodes.values())
      .filter(
        (node) => node.conversationId === activeConversationId && !node.isReply
      )
      .map((node): Node => ({
        id: node.id,
        type: 'conversation',
        position: node.position,
        data: { node },
      }));
  }, [storeNodes, activeConversationId]);

  // Convert store edges to React Flow edges
  const baseEdges = useMemo(() => {
    if (!activeConversationId) return [];

    return Array.from(storeEdges.values())
      .filter((edge) => {
        if (edge.conversationId !== activeConversationId) return false;
        const source = storeNodes.get(edge.source);
        const target = storeNodes.get(edge.target);
        return !(source?.isReply || target?.isReply);
      })
      .map((edge): Edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        animated: false,
        style: { stroke: '#94a3b8', strokeWidth: 2 },
      }));
  }, [storeEdges, storeNodes, activeConversationId]);

  const contextNodes = useMemo(() => {
    if (!activeConversationId) return [];
    const conversation = conversations.get(activeConversationId);
    if (!conversation) return [];

    const rootNode = storeNodes.get(conversation.rootNodeId);
    if (!rootNode) return [];

    const project = conversation.projectId
      ? projects.get(conversation.projectId) || null
      : null;
    const memoryPreview = memoryRetrievalByConversation[conversation.id] || null;
    const extraTokens = estimateContextExtraTokens({
      toolSettings,
      memorySettings,
      memoryPreview,
    });
    const contextSettings = conversation.contextSettings ?? {};
    const attachmentNames = new Map<string, string>();

    for (const node of storeNodes.values()) {
      if (node.conversationId !== conversation.id) continue;
      if (node.isReply) continue;
      for (const message of node.messages) {
        if (!message.attachments) continue;
        for (const attachment of message.attachments) {
          attachmentNames.set(attachment.id, attachment.name);
        }
      }
    }

    const items: Array<{
      id: string;
      title: string;
      description?: string;
      enabled: boolean;
      badge?: string;
      details?: string[];
      conversationId: string;
      settingKey?: keyof ContextSettings;
    }> = [];

    if (conversation.systemPrompt) {
      items.push({
        id: 'system-prompt',
        title: 'System prompt',
        description: conversation.systemPrompt.slice(0, 120),
        enabled: contextSettings.includeSystemPrompt ?? true,
        badge: 'System',
        conversationId: conversation.id,
        settingKey: 'includeSystemPrompt',
      });
    }

    if (customProfile.trim() || customResponseStyle.trim()) {
      const details = [];
      if (customProfile.trim()) details.push('Profile');
      if (customResponseStyle.trim()) details.push('Response style');
      items.push({
        id: 'custom-instructions',
        title: 'Custom instructions',
        description: details.join(' + '),
        enabled: contextSettings.includeCustomInstructions ?? true,
        badge: 'Custom',
        conversationId: conversation.id,
        settingKey: 'includeCustomInstructions',
      });
    }

    if (project?.customProfile?.trim() || project?.customResponseStyle?.trim()) {
      const details = [];
      if (project?.customProfile?.trim()) details.push('Project profile');
      if (project?.customResponseStyle?.trim()) details.push('Response style');
      items.push({
        id: 'project-instructions',
        title: 'Project instructions',
        description: details.join(' + '),
        enabled: contextSettings.includeProjectInstructions ?? true,
        badge: 'Project',
        conversationId: conversation.id,
        settingKey: 'includeProjectInstructions',
      });
    }

    if (attachmentNames.size > 0) {
      const summaryLabel = attachmentNames.size === 1 ? 'summary' : 'summaries';
      items.push({
        id: 'attachment-context',
        title: 'Attachments',
        description: `${attachmentNames.size} file ${summaryLabel}`,
        enabled: contextSettings.includeAttachmentContext ?? true,
        badge: 'Files',
        details: Array.from(attachmentNames.values()).slice(0, 4),
        conversationId: conversation.id,
        settingKey: 'includeAttachmentContext',
      });
    }

    if (project?.attachments && project.attachments.length > 0) {
      const summaryLabel = project.attachments.length === 1 ? 'summary' : 'summaries';
      items.push({
        id: 'project-attachments',
        title: 'Project attachments',
        description: `${project.attachments.length} file ${summaryLabel}`,
        enabled: contextSettings.includeProjectAttachmentContext ?? true,
        badge: 'Project',
        details: project.attachments.slice(0, 4).map((attachment) => attachment.name),
        conversationId: conversation.id,
        settingKey: 'includeProjectAttachmentContext',
      });
    }

    if (toolSettings.enabled) {
      items.push({
        id: 'tools-overhead',
        title: 'Tools / MCP',
        description: `~${extraTokens.tools.total.toLocaleString()} tokens`,
        enabled: true,
        badge: 'Tools',
        details: [
          `Local tools: ${extraTokens.tools.localToolCount}`,
          `MCP servers: ${extraTokens.tools.mcpServerCount}`,
          `MCP tools: ${extraTokens.tools.mcpToolCount}`,
        ],
        conversationId: conversation.id,
      });
    }

    if (memorySettings.enabled) {
      items.push({
        id: 'memory-overhead',
        title: 'Memory',
        description: `~${extraTokens.memory.total.toLocaleString()} tokens`,
        enabled: true,
        badge: 'Memory',
        details: [
          `Source: ${extraTokens.memory.source}`,
          `Items: ${extraTokens.memory.itemCount}`,
        ],
        conversationId: conversation.id,
      });
    }

    if (items.length === 0) return [];

    const baseX = rootNode.position.x - 320;
    const total = items.length;
    const spacing = 140;
    const startY = rootNode.position.y - ((total - 1) * spacing) / 2;

    return items.map((item, index): Node => ({
      id: `context:${item.id}`,
      type: 'contextItem',
      position: {
        x: baseX,
        y: startY + index * spacing,
      },
      data: item,
      className: 'nopan',
      style: { cursor: 'default' },
      draggable: false,
      selectable: true,
      focusable: false,
      connectable: false,
    }));
  }, [
    activeConversationId,
    conversations,
    customProfile,
    customResponseStyle,
    memoryRetrievalByConversation,
    memorySettings,
    projects,
    storeNodes,
    toolSettings,
  ]);

  const contextEdges = useMemo(() => {
    if (!activeConversationId) return [];
    const conversation = conversations.get(activeConversationId);
    if (!conversation) return [];
    const rootId = conversation.rootNodeId;
    return contextNodes.map((node) => ({
      id: `edge:${node.id}:${rootId}`,
      source: node.id,
      target: rootId,
      type: 'smoothstep',
      animated: false,
      style: {
        stroke: '#cbd5f5',
        strokeWidth: 1.5,
        strokeDasharray: '4 4',
      },
    }));
  }, [contextNodes, conversations, activeConversationId]);

  const initialNodes = useMemo(() => [...baseNodes, ...contextNodes], [baseNodes, contextNodes]);
  const initialEdges = useMemo(() => [...baseEdges, ...contextEdges], [baseEdges, contextEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync with store when it changes
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // Auto-layout on first load if nodes have default positions
  useEffect(() => {
    if (baseNodes.length > 0) {
      const allAtOrigin = baseNodes.every(
        (n) => n.position.x === 0 && n.position.y === 0
      );
      if (allAtOrigin) {
        autoLayoutNodes();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]); // Only on conversation change

  // Handle node drag end - update position in store
  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id.startsWith('context:')) return;
      updateNodePosition(node.id, node.position);
    },
    [updateNodePosition]
  );

  // Handle edge connection
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source.startsWith('context:')) return;
      if (connection.target.startsWith('context:')) return;

      // Check if connection would create a cycle
      if (!canCreateEdge(connection.source, connection.target)) {
        alert('Cannot create edge: would create a cycle in the graph');
        return;
      }

      // Create edge in store
      const edgeId = createEdge(connection.source, connection.target);
      if (edgeId) {
        setEdges((eds) =>
          addEdge(
            {
              ...connection,
              id: edgeId,
              type: 'smoothstep',
              style: { stroke: '#94a3b8', strokeWidth: 2 },
            },
            eds
          )
        );
      }
    },
    [canCreateEdge, createEdge, setEdges]
  );

  // Validate connection before allowing
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (!connection.source || !connection.target) return false;
      if (connection.source === connection.target) return false;
      if (connection.source.startsWith('context:')) return false;
      if (connection.target.startsWith('context:')) return false;
      return canCreateEdge(connection.source, connection.target);
    },
    [canCreateEdge]
  );

  return (
    <div className="h-full w-full relative bg-gray-50 dark:bg-gray-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={theme === 'dark' ? '#1f2937' : '#e5e7eb'}
        />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as unknown as ConversationNodeData | undefined;
            if (node.id.startsWith('context:')) return '#94a3b8';
            if (data?.node?.status === 'streaming') return '#3b82f6';
            if (data?.node?.status === 'error') return '#ef4444';
            return '#6b7280';
          }}
          maskColor={theme === 'dark' ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.1)'}
        />
      </ReactFlow>

      <GraphControls />
    </div>
  );
}
