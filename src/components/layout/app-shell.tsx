import React, { useState } from 'react';
import { TopNav } from './top-nav';
import { Sidebar } from './sidebar';
import { CommandPalette } from './command-palette';

interface AppShellProps {
  currentView: string;
  onSelectView: (view: string) => void;
  children: React.ReactNode;
}

export function AppShell({ currentView, onSelectView, children }: AppShellProps) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-obsidian-900 text-obsidian-100 antialiased selection:bg-blue-600/30 selection:text-blue-200">
      <TopNav onOpenCommandPalette={() => setCommandPaletteOpen(true)} />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar currentView={currentView} onSelectView={onSelectView} />
        <main className="flex-1 overflow-y-auto bg-obsidian-950/40 p-6 flex flex-col">
          {children}
        </main>
      </div>

      {commandPaletteOpen && (
        <CommandPalette
          onSelectView={(view) => {
            onSelectView(view);
            setCommandPaletteOpen(false);
          }}
        />
      )}
    </div>
  );
}
