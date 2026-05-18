import type { CSSProperties, ReactNode } from "react";

type WorkspaceLayoutProps = {
  children: ReactNode;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  rightDrawerWidth: number;
};

export function WorkspaceLayout({ children, leftCollapsed, rightCollapsed, rightDrawerWidth }: WorkspaceLayoutProps) {
  const workspaceGridStyle = {
    "--ai-drawer-width": `${rightDrawerWidth}px`
  } as CSSProperties;

  return (
    <div
      className="layered-workspace-grid"
      data-left-collapsed={leftCollapsed}
      data-right-collapsed={rightCollapsed}
      style={workspaceGridStyle}
    >
      {children}
    </div>
  );
}
