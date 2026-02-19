'use client';

import { useState } from 'react';
import { X, ArrowRight, ChevronDown } from 'lucide-react';
import { Platform } from '@/lib/types';

const platformColors: Record<Platform, string> = {
  ChatGPT: '#F3F4F6',
  Claude: '#F7D8BA',
  Gemini: '#3A62D9',
  DeepSeek: '#172554',
};

interface Node {
  id: number;
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
  platform: Platform;
}

interface Edge {
  source: number;
  target: number;
  weight: number;
}

const mockNodes: Node[] = [
  { id: 1, x: 420, y: 280, r: 22, color: '#F3F4F6', label: 'React Virtual List', platform: 'ChatGPT' },
  { id: 2, x: 580, y: 200, r: 18, color: '#F7D8BA', label: 'Rust Ownership', platform: 'Claude' },
  { id: 3, x: 650, y: 340, r: 16, color: '#3A62D9', label: 'AI Papers 2024', platform: 'Gemini' },
  { id: 4, x: 300, y: 200, r: 20, color: '#172554', label: 'PostgreSQL Tuning', platform: 'DeepSeek' },
  { id: 5, x: 500, y: 420, r: 24, color: '#F3F4F6', label: 'Chrome Extension', platform: 'ChatGPT' },
  { id: 6, x: 740, y: 260, r: 17, color: '#F7D8BA', label: 'TypeScript Migration', platform: 'Claude' },
  { id: 7, x: 350, y: 380, r: 15, color: '#172554', label: 'Docker Compose', platform: 'DeepSeek' },
  { id: 8, x: 680, y: 440, r: 16, color: '#3A62D9', label: 'SwiftUI vs Flutter', platform: 'Gemini' },
];

const mockEdges: Edge[] = [
  { source: 1, target: 5, weight: 0.87 },
  { source: 1, target: 6, weight: 0.74 },
  { source: 2, target: 6, weight: 0.65 },
  { source: 4, target: 7, weight: 0.78 },
  { source: 3, target: 8, weight: 0.61 },
  { source: 5, target: 6, weight: 0.55 },
  { source: 1, target: 4, weight: 0.42 },
];

export function NetworkTab() {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | 'all'>('all');
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const platforms: (Platform | 'all')[] = ['all', 'ChatGPT', 'Claude', 'Gemini', 'DeepSeek'];

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-10 bg-bg-tertiary border-b border-border-subtle px-4 flex items-center gap-3">
        <div className="flex items-center gap-2">
          {platforms.map((platform) => (
            <button
              key={platform}
              onClick={() => setSelectedPlatform(platform)}
              className={`px-3 py-1 rounded-full text-[11px] font-sans font-medium transition-all ${
                selectedPlatform === platform
                  ? platform === 'all'
                    ? 'bg-accent-primary text-white'
                    : 'text-white'
                  : 'bg-bg-surface-card text-text-secondary hover:bg-bg-surface-card-hover'
              }`}
              style={
                selectedPlatform === platform && platform !== 'all'
                  ? { backgroundColor: platformColors[platform] }
                  : {}
              }
            >
              {platform === 'all' ? 'All' : platform}
            </button>
          ))}
        </div>

        <button className="ml-auto px-3 py-1 rounded-md bg-bg-surface-card hover:bg-bg-surface-card-hover text-[11px] font-sans text-text-secondary transition-all flex items-center gap-1.5">
          <span>Time Range</span>
          <ChevronDown strokeWidth={1.5} className="w-3 h-3" />
        </button>

        <button className="px-3 py-1 rounded-md bg-bg-surface-card hover:bg-bg-surface-card-hover text-[11px] font-sans text-text-secondary transition-all">
          Reset View
        </button>
      </div>

      {/* Graph Area */}
      <div className="flex-1 relative bg-bg-tertiary overflow-hidden">
        <svg width="100%" height="100%" viewBox="0 0 1040 580" className="absolute inset-0">
          {/* Render edges first */}
          {mockEdges.map((edge) => {
            const s = mockNodes.find((n) => n.id === edge.source);
            const t = mockNodes.find((n) => n.id === edge.target);
            if (!s || !t) return null;
            return (
              <line
                key={`${edge.source}-${edge.target}`}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke="#E5E3DB"
                strokeWidth={edge.weight * 3}
                strokeOpacity={0.4 + edge.weight * 0.4}
              />
            );
          })}
          {/* Render nodes */}
          {mockNodes.map((node) => (
            <g
              key={node.id}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedNode(node)}
              className="hover:opacity-90 transition-opacity"
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill={node.color}
                fillOpacity={0.85}
                stroke="#FFFFFF"
                strokeWidth={2}
              />
              <text
                x={node.x}
                y={node.y + node.r + 14}
                textAnchor="middle"
                fontSize={11}
                fill="#6B6B6B"
                fontFamily="'Nunito Sans', sans-serif"
              >
                {node.label.length > 16 ? node.label.slice(0, 16) + '…' : node.label}
              </text>
            </g>
          ))}
        </svg>

        {/* Legend - bottom left */}
        <div className="absolute bottom-4 left-4 bg-bg-surface-card rounded-lg px-3 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex items-center gap-4">
          {(['ChatGPT', 'Claude', 'Gemini', 'DeepSeek'] as Platform[]).map((platform) => (
            <div key={platform} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: platformColors[platform] }}
              />
              <span className="text-[11px] font-sans text-text-secondary">{platform}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right Drawer */}
      {selectedNode && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setSelectedNode(null)}
          />
          <div
            className="fixed top-0 right-0 bottom-0 w-80 bg-bg-primary shadow-2xl z-50 overflow-y-auto transition-transform duration-200"
            style={{ transform: 'translateX(0)' }}
          >
            <div className="p-4">
              <button
                onClick={() => setSelectedNode(null)}
                className="flex items-center gap-2 text-sm font-sans text-text-secondary hover:text-text-primary mb-4 transition-colors"
              >
                <X strokeWidth={1.5} className="w-4 h-4" />
                <span>Close</span>
              </button>

              <h2 className="text-lg font-serif font-normal text-text-primary mb-3">
                {selectedNode.label}
              </h2>

              <div className="flex items-center gap-2 mb-4">
                <span
                  className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium leading-none"
                  style={{
                    backgroundColor: platformColors[selectedNode.platform],
                    color: selectedNode.platform === 'ChatGPT' || selectedNode.platform === 'Claude' ? '#1A1A1A' : '#FFFFFF',
                  }}
                >
                  {selectedNode.platform}
                </span>
                <span className="text-xs font-sans text-text-tertiary">2yr ago</span>
              </div>

              {/* AI Summary Card */}
              <div className="mb-6 p-3 rounded-lg bg-bg-surface-card">
                <div className="flex items-center gap-2 text-sm font-sans text-text-primary mb-2">
                  <span>✓ Analyzed</span>
                </div>
                <p className="text-xs font-sans text-text-secondary">
                  Discussion about {selectedNode.label.toLowerCase()} covering implementation strategies, best practices, and common patterns.
                </p>
              </div>

              {/* View in Library */}
              <button className="w-full py-2.5 px-4 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-white text-sm font-sans font-medium transition-all flex items-center justify-center gap-2">
                <span>View in Library</span>
                <ArrowRight strokeWidth={1.5} className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
