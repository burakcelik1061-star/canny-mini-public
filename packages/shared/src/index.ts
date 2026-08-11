// Shared types between apps/web and apps/api.
// Mirrors the ER diagram in docs/0.1-scope-and-data-model.md.
// This package has no build step for now — it is consumed as raw TS
// via workspace linking (both apps use a bundler/ts-node that can
// resolve .ts directly). If that stops working we'll add a build step.

export type OrgRole = "owner" | "admin" | "member";

export type BoardVisibility = "public" | "private";

export type PostStatus =
  | "under_review"
  | "planned"
  | "in_progress"
  | "complete"
  | "closed";

export type InvitationStatus = "pending" | "accepted" | "expired";

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface OrganizationMember {
  id: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  orgId: string;
  email: string;
  role: OrgRole;
  token: string;
  status: InvitationStatus;
  createdAt: string;
}

export interface Board {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  visibility: BoardVisibility;
  createdAt: string;
}

export interface Post {
  id: string;
  boardId: string;
  authorId: string;
  title: string;
  description: string;
  status: PostStatus;
  mergedIntoPostId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Vote {
  id: string;
  postId: string;
  userId: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  isOfficial: boolean;
  createdAt: string;
}

export interface Tag {
  id: string;
  orgId: string;
  name: string;
  color: string;
}
