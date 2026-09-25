"use client";

import { isElevatedPlatformRole } from "@/lib/staff-role";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import {
  CreditCard,
  Shield,
  Ticket,
  User,
  CheckCircle2,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_PASSWORD_RESET } from "@/lib/default-reset-password";
import { cn } from "@/lib/cn";
import { MAX_PROFILE_IMAGE_FILE_BYTES } from "@/lib/profile-image-limits";

const BIO_KEY = "admin-account-bio-draft";
const MAX_BIO = 250;

type TabId = "profile" | "security" | "billing";

type AccountDetails = {
  displayName: string | null;
  username: string | null;
  accountCreatedAt: string | null;
  profileImage: string | null;
  profileImageZoom: number;
  profileImagePosX: number;
  profileImagePosY: number;
  personalTicketsResolved: number | null;
  hasAgentProfile: boolean;
};

function initials(name: string | null | undefined, email: string | null | undefined) {
  const n = (name ?? "").trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0]![0] + parts[1]![0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }
  const e = email ?? "?";
  return e.slice(0, 2).toUpperCase();
}

function formatAge(iso: string | null, referenceMs: number | null) {
  if (!iso || referenceMs == null) return "—";
  const created = new Date(iso).getTime();
  if (!Number.isFinite(created)) return "—";
  const days = Math.max(0, Math.floor((referenceMs - created) / (24 * 60 * 60 * 1000)));
  if (days < 1) return "Today";
  if (days === 1) return "1 day";
  return `${days.toLocaleString()} days`;
}

const tabs: { id: TabId; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "security", label: "Security", icon: Shield },
  { id: "billing", label: "Billing", icon: CreditCard },
];

export function AccountSettingsShell() {
  const { data, status, update: updateSession } = useSession();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<TabId>("profile");
  const [details, setDetails] = useState<AccountDetails | null>(null);
  const [bio, setBio] = useState("");
  const [bioBaseline, setBioBaseline] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [profileImageBusy, setProfileImageBusy] = useState(false);
  const [profileImageMessage, setProfileImageMessage] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePosX, setImagePosX] = useState(50);
  const [imagePosY, setImagePosY] = useState(50);
  const [isFramingEditMode, setIsFramingEditMode] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [clockMs, setClockMs] = useState<number | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [displayNamePassword, setDisplayNamePassword] = useState("");
  const [displayNameBusy, setDisplayNameBusy] = useState(false);
  const [displayNameMessage, setDisplayNameMessage] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameMessage, setUsernameMessage] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [requestType, setRequestType] = useState<"SUSPENSION" | "DELETION" | "PASSWORD_RESET">("SUSPENSION");
  const [requestReason, setRequestReason] = useState("");
  const [requestPassword, setRequestPassword] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestHistory, setRequestHistory] = useState<
    Array<{ id: string; requestType: string; status: string; createdAt: string }>
  >([]);

  const user = data?.user;
  const name = user?.name ?? "";
  const email = user?.email ?? "";
  const role = user?.role ?? "";
  const displayName = details?.displayName ?? name;
  const oauthOnly =
    typeof user?.authProvider === "string" &&
    user.authProvider.trim().toLowerCase() === "google";

  useEffect(() => {
    queueMicrotask(() => {
      if (typeof window === "undefined") return;
      const stored = window.localStorage.getItem(BIO_KEY) ?? "";
      setBio(stored);
      setBioBaseline(stored);
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => setClockMs(Date.now()));
  }, []);

  const loadDetails = useCallback(async () => {
    const res = await fetch("/api/me/account-details", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as AccountDetails;
    setDetails(json);
    setNewDisplayName(json.displayName ?? "");
    setImageZoom(json.profileImageZoom ?? 1);
    setImagePosX(json.profileImagePosX ?? 50);
    setImagePosY(json.profileImagePosY ?? 50);
    setIsFramingEditMode(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadDetails());
  }, [loadDetails]);

  useEffect(() => {
    if (tab !== "security") return;
    queueMicrotask(() => void loadRequestHistory());
  }, [tab]);

  const dirty = bio !== bioBaseline;

  async function loadRequestHistory() {
    const res = await fetch("/api/me/security/account-requests", { cache: "no-store" });
    if (!res.ok) return;
    const payload = (await res.json()) as {
      rows: Array<{ id: string; requestType: string; status: string; createdAt: string }>;
    };
    setRequestHistory(payload.rows ?? []);
  }

  function saveBio() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BIO_KEY, bio.slice(0, MAX_BIO));
    }
    setBioBaseline(bio.slice(0, MAX_BIO));
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2200);
  }

  function discardBio() {
    setBio(bioBaseline);
  }

  async function uploadProfileImage(file: File) {
    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      setProfileImageMessage("Only PNG, JPG, WEBP, and GIF are supported.");
      return;
    }
    if (file.size > MAX_PROFILE_IMAGE_FILE_BYTES) {
      setProfileImageMessage("Image too large. Please upload up to 10MB.");
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.readAsDataURL(file);
    });

    setProfileImageBusy(true);
    setProfileImageMessage(null);
    const res = await fetch("/api/me/profile-image", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageDataUrl: dataUrl }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      profileImage?: string | null;
      profileImageZoom?: number;
      profileImagePosX?: number;
      profileImagePosY?: number;
    };
    setProfileImageBusy(false);
    if (!res.ok) {
      setProfileImageMessage(payload.error ?? "Could not upload image.");
      return;
    }
    setDetails((prev) =>
      prev
        ? {
            ...prev,
            profileImage: payload.profileImage ?? dataUrl,
            profileImageZoom: payload.profileImageZoom ?? 1,
            profileImagePosX: payload.profileImagePosX ?? 50,
            profileImagePosY: payload.profileImagePosY ?? 50,
          }
        : prev,
    );
    setImageZoom(payload.profileImageZoom ?? 1);
    setImagePosX(payload.profileImagePosX ?? 50);
    setImagePosY(payload.profileImagePosY ?? 50);
    setIsFramingEditMode(true);
    setProfileImageMessage("Image uploaded. Adjust it, then click Save framing to lock it.");
    await updateSession();
    window.dispatchEvent(new Event("profile-image-updated"));
  }

  async function removeProfileImage() {
    setProfileImageBusy(true);
    setProfileImageMessage(null);
    const res = await fetch("/api/me/profile-image", { method: "DELETE" });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setProfileImageBusy(false);
    if (!res.ok) {
      setProfileImageMessage(payload.error ?? "Could not remove image.");
      return;
    }
    setDetails((prev) =>
      prev
        ? { ...prev, profileImage: null, profileImageZoom: 1, profileImagePosX: 50, profileImagePosY: 50 }
        : prev,
    );
    setImageZoom(1);
    setImagePosX(50);
    setImagePosY(50);
    setIsFramingEditMode(false);
    setProfileImageMessage("Profile image removed.");
    if (imageInputRef.current) imageInputRef.current.value = "";
    await updateSession();
    window.dispatchEvent(new Event("profile-image-updated"));
  }

  async function saveProfileImageFraming() {
    if (!details?.profileImage) return;
    if (!isFramingEditMode) {
      setIsFramingEditMode(true);
      setProfileImageMessage("Edit mode enabled. Drag image to move, scroll to zoom, then click Save framing.");
      return;
    }
    setProfileImageBusy(true);
    setProfileImageMessage(null);
    const res = await fetch("/api/me/profile-image", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zoom: imageZoom, posX: imagePosX, posY: imagePosY }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      profileImageZoom?: number;
      profileImagePosX?: number;
      profileImagePosY?: number;
    };
    setProfileImageBusy(false);
    if (!res.ok) {
      setProfileImageMessage(payload.error ?? "Could not save image position.");
      return;
    }
    setDetails((prev) =>
      prev
        ? {
            ...prev,
            profileImageZoom: payload.profileImageZoom ?? imageZoom,
            profileImagePosX: payload.profileImagePosX ?? imagePosX,
            profileImagePosY: payload.profileImagePosY ?? imagePosY,
          }
        : prev,
    );
    setImageZoom(payload.profileImageZoom ?? imageZoom);
    setImagePosX(payload.profileImagePosX ?? imagePosX);
    setImagePosY(payload.profileImagePosY ?? imagePosY);
    setIsFramingEditMode(false);
    setProfileImageMessage("Profile image framing saved and locked.");
    window.dispatchEvent(new Event("profile-image-updated"));
  }

  function handleImagePointerMove(e: React.PointerEvent<HTMLImageElement>) {
    if (!isFramingEditMode || !isDraggingImage) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nextX = ((e.clientX - rect.left) / rect.width) * 100;
    const nextY = ((e.clientY - rect.top) / rect.height) * 100;
    setImagePosX(Math.max(0, Math.min(100, Math.round(nextX))));
    setImagePosY(Math.max(0, Math.min(100, Math.round(nextY))));
  }

  function handleImageWheel(e: React.WheelEvent<HTMLImageElement>) {
    if (!isFramingEditMode) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setImageZoom((prev) => Math.max(1, Math.min(3, Math.round((prev + delta) * 100) / 100)));
  }

  async function submitEmailChange() {
    if (!newEmail.trim() || (!oauthOnly && !emailPassword)) return;
    setEmailBusy(true);
    setEmailMessage(null);
    const res = await fetch("/api/me/security/email", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newEmail, ...(oauthOnly ? {} : { password: emailPassword }) }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setEmailBusy(false);
    if (!res.ok) {
      setEmailMessage(payload.error ?? "Could not change email.");
      return;
    }
    setEmailMessage("Email updated. Please sign in again with your new email.");
    await signOut({ callbackUrl: "/signin" });
  }

  async function submitDisplayNameChange() {
    const nextDisplayName = newDisplayName.trim().replace(/\s+/g, " ");
    if (!nextDisplayName || (!oauthOnly && !displayNamePassword)) {
      setDisplayNameMessage(
        oauthOnly ? "Display name is required." : "Display name and current password are required.",
      );
      return;
    }
    setDisplayNameBusy(true);
    setDisplayNameMessage(null);
    const res = await fetch("/api/me/security/display-name", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: nextDisplayName,
        ...(oauthOnly ? {} : { password: displayNamePassword }),
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string; displayName?: string };
    setDisplayNameBusy(false);
    if (!res.ok) {
      setDisplayNameMessage(payload.error ?? "Could not change display name.");
      return;
    }
    const savedDisplayName = payload.displayName ?? nextDisplayName;
    setDetails((prev) => (prev ? { ...prev, displayName: savedDisplayName } : prev));
    setNewDisplayName(savedDisplayName);
    setDisplayNamePassword("");
    setDisplayNameMessage("Display name updated.");
    await updateSession();
  }

  async function submitUsernameChange() {
    if (!newUsername.trim() || (!oauthOnly && !usernamePassword)) return;
    setUsernameBusy(true);
    setUsernameMessage(null);
    const res = await fetch("/api/me/security/username", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        newUsername,
        ...(oauthOnly ? {} : { password: usernamePassword }),
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setUsernameBusy(false);
    if (!res.ok) {
      setUsernameMessage(payload.error ?? "Could not change username.");
      return;
    }
    setUsernameMessage("Username updated. Please sign in again with your new username.");
    await signOut({ callbackUrl: "/signin" });
  }

  async function submitAccountRequest() {
    if (!oauthOnly && !requestPassword) return;
    setRequestBusy(true);
    setRequestMessage(null);
    const res = await fetch("/api/me/security/account-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestType,
        reason: requestReason,
        ...(oauthOnly ? {} : { password: requestPassword }),
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setRequestBusy(false);
    if (!res.ok) {
      setRequestMessage(payload.error ?? "Could not submit request.");
      return;
    }
    setRequestPassword("");
    setRequestReason("");
    setRequestMessage("Request submitted to Admin/SuperAdmin for review.");
    await loadRequestHistory();
  }

  async function submitPasswordChange() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage("All password fields are required.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage("New password and confirmation do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMessage("New password must be at least 8 characters.");
      return;
    }

    setPasswordBusy(true);
    setPasswordMessage(null);
    const res = await fetch("/api/me/security/password", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setPasswordBusy(false);
    if (!res.ok) {
      setPasswordMessage(payload.error ?? "Could not update password.");
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMessage("Password updated. Please sign in again.");
    await signOut({ callbackUrl: "/signin" });
  }

  const roleLabel = useMemo(() => role || "—", [role]);
  const isAdminRole = isElevatedPlatformRole(role) || role === "Admin";

  if (status === "loading") {
    return <p className="text-sm text-zinc-500">Loading session…</p>;
  }

  if (!user) {
    return <p className="text-sm text-zinc-500">You are not signed in.</p>;
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as TabId)}
      className="flex flex-col gap-10 text-zinc-900 dark:text-zinc-100 lg:flex-row lg:gap-12"
    >
      {/* Side nav */}
      <aside className="shrink-0 lg:w-56">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-600 dark:text-zinc-500">
          Account settings
        </p>

        <TabsList
          className="mt-6 flex h-auto flex-col items-stretch justify-start gap-0.5 rounded-none bg-transparent p-0 text-muted"
          aria-label="Account sections"
        >
          {tabs.map(({ id, label, icon: Icon }) => {
            return (
              <TabsTrigger
                key={id}
                value={id}
                className="flex w-full justify-start gap-2.5 rounded-lg border-l-4 border-transparent bg-transparent py-2.5 pl-3 pr-3 text-left text-sm font-medium text-zinc-600 shadow-none hover:bg-zinc-100 hover:text-zinc-900 data-[state=active]:border-orange-500 data-[state=active]:bg-orange-500/10 data-[state=active]:text-orange-900 data-[state=active]:shadow-none dark:text-zinc-400 dark:hover:bg-zinc-900/80 dark:hover:text-zinc-200 dark:data-[state=active]:text-orange-100"
              >
                <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                {label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <Link
          href={isAdminRole ? "/admin/ticket-requests" : "/tickets/new"}
          className="mt-8 flex w-full items-center justify-center rounded-xl border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-center text-sm font-semibold text-orange-900 transition hover:border-orange-500/60 hover:bg-orange-500/15 dark:text-orange-100 dark:hover:border-orange-400/60"
        >
          {isAdminRole ? "Create requests" : "Support ticket"}
        </Link>
      </aside>

      {/* Main */}
      <div className="min-w-0 flex-1 space-y-10">
        {tab === "profile" ? (
          <>
            <header>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 md:text-3xl dark:text-white">
                Profile information
              </h1>
            </header>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,280px)_1fr] lg:items-start">
              {/* Left column */}
              <div className="space-y-4">
                <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:border-zinc-800 dark:bg-zinc-950/60 dark:shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
                  <div
                    className="flex aspect-square items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-100 dark:from-zinc-800 dark:to-zinc-950"
                    style={{ overscrollBehavior: "contain" }}
                    onWheelCapture={(e) => {
                      if (!isFramingEditMode || !details?.profileImage) return;
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    {details?.profileImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={details.profileImage}
                        alt="Profile"
                        className={cn(
                          "h-full w-full object-cover",
                          isFramingEditMode ? "cursor-move" : "cursor-default",
                        )}
                        style={{
                          objectPosition: `${imagePosX}% ${imagePosY}%`,
                          transform: `scale(${imageZoom})`,
                          transformOrigin: "center",
                        }}
                        onPointerDown={(e) => {
                          if (!isFramingEditMode) return;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setIsDraggingImage(true);
                        }}
                        onPointerMove={handleImagePointerMove}
                        onPointerUp={(e) => {
                          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                            e.currentTarget.releasePointerCapture(e.pointerId);
                          }
                          setIsDraggingImage(false);
                        }}
                        onPointerCancel={() => setIsDraggingImage(false)}
                        onWheel={handleImageWheel}
                      />
                    ) : (
                      <span className="text-4xl font-bold tracking-tight text-orange-400/95">
                        {initials(displayName, email)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-[#0c0c0c]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600 dark:text-zinc-500">
                    Profile image
                  </p>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    disabled={profileImageBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadProfileImage(file);
                    }}
                    className="block w-full text-xs text-zinc-700 file:mr-3 file:rounded-full file:border file:border-zinc-300 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-800 hover:file:bg-zinc-200 dark:text-zinc-300 dark:file:border-zinc-700 dark:file:bg-zinc-900 dark:file:text-zinc-200"
                  />
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    PNG, JPG, WEBP, or GIF — up to 10 MB.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 rounded-full px-3 text-xs"
                      disabled={profileImageBusy || !details?.profileImage}
                      onClick={() => void removeProfileImage()}
                    >
                      Remove
                    </Button>
                    <Button
                      type="button"
                      className="h-8 rounded-full px-3 text-xs"
                      disabled={profileImageBusy || !details?.profileImage}
                      onClick={() => void saveProfileImageFraming()}
                    >
                      {isFramingEditMode ? "Save framing" : "Edit / Save framing"}
                    </Button>
                  </div>
                  {details?.profileImage ? (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {isFramingEditMode
                        ? "Edit mode: drag image to move, use mouse wheel to zoom, then click Save framing."
                        : "Image is locked. Click Edit / Save framing to adjust with drag + wheel zoom."}
                    </p>
                  ) : null}
                  {profileImageMessage ? (
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{profileImageMessage}</p>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-[#0c0c0c]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 dark:text-zinc-500">Quick stats</p>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="flex justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800/80">
                      <dt className="text-zinc-600 dark:text-zinc-500">Last login</dt>
                      <dd className="font-medium text-zinc-900 dark:text-zinc-200">This session</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800/80">
                      <dt className="text-zinc-600 dark:text-zinc-500">Account age</dt>
                      <dd className="font-medium text-zinc-900 dark:text-zinc-200">
                        {formatAge(details?.accountCreatedAt ?? null, clockMs)}
                      </dd>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <dt className="text-zinc-600 dark:text-zinc-500">Access level</dt>
                      <dd>
                        <span className="inline-flex rounded-full border border-orange-500/40 bg-orange-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-orange-900 dark:text-orange-200">
                          {roleLabel}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Form column */}
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                    Full name
                    <Input readOnly value={displayName || "—"} className="mt-1 cursor-not-allowed opacity-90" />
                  </label>
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                    Email address
                    <Input readOnly value={email || "—"} className="mt-1 cursor-not-allowed opacity-90" />
                  </label>
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300 sm:col-span-2">
                    Username
                    <Input
                      readOnly
                      value={details?.username?.trim() ? details.username : "—"}
                      className="mt-1 cursor-not-allowed opacity-90"
                    />
                    <span className="mt-1.5 block text-xs text-zinc-500">
                      To change your username, use <strong className="font-medium text-zinc-700 dark:text-zinc-400">Security</strong>
                      {!oauthOnly ? " (current password required)." : "."}
                    </span>
                  </label>
                </div>

                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  Professional bio
                  <Textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
                    placeholder="Brief description for your profile."
                    rows={5}
                    className="mt-1 resize-y text-zinc-900 placeholder:text-zinc-500 dark:text-zinc-100 dark:placeholder:text-zinc-600"
                  />
                  <span className="mt-1.5 block text-xs text-zinc-500">
                    Visible to your team where supported. Maximum {MAX_BIO} characters.
                  </span>
                </label>

                <div className="flex flex-col gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-end">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      className="rounded-xl text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      onClick={discardBio}
                      disabled={!dirty}
                    >
                      Discard
                    </Button>
                    <Button type="button" className="rounded-xl px-6" onClick={saveBio} disabled={!dirty}>
                      Save changes
                    </Button>
                  </div>
                </div>
                {savedFlash ? (
                  <p className="text-sm font-medium text-orange-700 dark:text-orange-300">Bio saved locally in this browser.</p>
                ) : null}
              </div>
            </div>

            {/* Activity strip */}
            <section className="space-y-4 border-t border-zinc-200 pt-10 dark:border-zinc-800/80">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-600 dark:text-zinc-500">Activity &amp; session</h2>
              <div className="grid gap-4 lg:grid-cols-3">
                <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-[#0c0c0c] lg:col-span-2">
                  <div className="flex gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 text-orange-400">
                      <CheckCircle2 className="size-5" aria-hidden />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-900 dark:text-zinc-200">
                        Security protocol active
                      </h3>
                      <p className="mt-3 text-[11px] font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-500">
                        {new Date().toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                </article>

                <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-[#0c0c0c]">
                  <div className="flex items-start justify-between gap-2">
                    <Ticket className="size-5 text-orange-400/90" aria-hidden />
                  </div>
                  <p className="mt-4 text-4xl font-bold tabular-nums text-orange-400">
                    {details?.hasAgentProfile
                      ? (details.personalTicketsResolved ?? 0).toLocaleString()
                      : "—"}
                  </p>
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
                    Requests resolved
                  </p>
                  <div className="mt-4 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-orange-500 transition-[width]"
                      style={{
                        width: `${Math.min(
                          100,
                          details?.hasAgentProfile && details.personalTicketsResolved
                            ? Math.min(100, details.personalTicketsResolved * 5)
                            : 8,
                        )}%`,
                      }}
                    />
                  </div>
                </article>
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-zinc-100 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950/40 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-400">
                  <Terminal className="size-4 shrink-0 text-orange-400/80" aria-hidden />
                  <span>
                    Session active for{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-200">{email}</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void signOut({ callbackUrl: "/signin" })}
                  className="text-sm font-semibold text-orange-400 hover:text-orange-300"
                >
                  Revoke / Sign out
                </button>
              </div>
            </section>
          </>
        ) : tab === "security" ? (
          <section className="space-y-8">
            <header>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 md:text-3xl dark:text-white">Security settings</h1>
            </header>

            {oauthOnly ? (
              <p className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                You sign in with Google. Password changes and password reset requests are not available.
              </p>
            ) : null}

            <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#0c0c0c]">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-800 dark:text-zinc-300">
                Change display name
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  New display name
                  <Input
                    type="text"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder={displayName || "Your name"}
                    className="mt-1"
                    maxLength={80}
                  />
                  <span className="mt-1 block text-[11px] text-zinc-500">2-80 characters.</span>
                </label>
                {!oauthOnly ? (
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  Current password
                  <Input
                    type="password"
                    value={displayNamePassword}
                    onChange={(e) => setDisplayNamePassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1"
                  />
                </label>
                ) : null}
              </div>
              <div className="mt-4">
                <Button type="button" onClick={() => void submitDisplayNameChange()} disabled={displayNameBusy}>
                  {displayNameBusy ? "Updating…" : "Update display name"}
                </Button>
                {displayNameMessage ? (
                  <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{displayNameMessage}</p>
                ) : null}
              </div>
            </article>

            <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#0c0c0c]">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-800 dark:text-zinc-300">
                Change username
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  New username
                  <Input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder={details?.username ?? "new.username"}
                    className="mt-1"
                  />
                  <span className="mt-1 block text-[11px] text-zinc-500">
                    3-32 chars: letters, numbers, dot, underscore, dash.
                  </span>
                </label>
                {!oauthOnly ? (
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  Current password
                  <Input
                    type="password"
                    value={usernamePassword}
                    onChange={(e) => setUsernamePassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1"
                  />
                </label>
                ) : null}
              </div>
              <div className="mt-4">
                <Button type="button" onClick={() => void submitUsernameChange()} disabled={usernameBusy}>
                  {usernameBusy ? "Updating…" : "Update username"}
                </Button>
                {usernameMessage ? <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{usernameMessage}</p> : null}
              </div>
            </article>

            <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#0c0c0c]">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-800 dark:text-zinc-300">
                Change email
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  New email
                  <Input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="mt-1"
                  />
                </label>
                {!oauthOnly ? (
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  Current password
                  <Input
                    type="password"
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1"
                  />
                </label>
                ) : null}
              </div>
              <div className="mt-4">
                <Button type="button" onClick={() => void submitEmailChange()} disabled={emailBusy}>
                  {emailBusy ? "Updating…" : "Update email"}
                </Button>
                {emailMessage ? <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{emailMessage}</p> : null}
              </div>
            </article>

            {!oauthOnly ? (
            <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#0c0c0c]">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-800 dark:text-zinc-300">
                Change password
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  Current password
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1"
                  />
                </label>
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  New password
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="mt-1"
                  />
                </label>
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  Confirm new password
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    className="mt-1"
                  />
                </label>
              </div>
              <div className="mt-4">
                <Button type="button" onClick={() => void submitPasswordChange()} disabled={passwordBusy}>
                  {passwordBusy ? "Updating…" : "Update password"}
                </Button>
                {passwordMessage ? <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{passwordMessage}</p> : null}
              </div>
            </article>
            ) : null}

            <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#0c0c0c]">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-800 dark:text-zinc-300">
                Account requests
              </h2>
              {!oauthOnly ? (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                If a <strong className="font-medium text-zinc-700 dark:text-zinc-300">password reset</strong> is approved,
                your portal password is set to: <code className="rounded bg-zinc-200 px-1 text-[11px] dark:bg-zinc-800">{DEFAULT_PASSWORD_RESET}</code>
              </p>
              ) : null}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  Request type
                  <select
                    value={requestType}
                    onChange={(e) =>
                      setRequestType(e.target.value as "SUSPENSION" | "DELETION" | "PASSWORD_RESET")
                    }
                    className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="SUSPENSION">Account suspension</option>
                    <option value="DELETION">Account deletion</option>
                    {!oauthOnly ? <option value="PASSWORD_RESET">Password reset</option> : null}
                  </select>
                </label>
                {!oauthOnly ? (
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  Confirm password
                  <Input
                    type="password"
                    value={requestPassword}
                    onChange={(e) => setRequestPassword(e.target.value)}
                    placeholder="••••••••"
                    className="mt-1"
                  />
                </label>
                ) : null}
              </div>
              <label className="mt-4 block text-sm font-medium text-zinc-800 dark:text-zinc-300">
                Reason (optional)
                <Textarea
                  rows={3}
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  className="mt-1"
                  placeholder="Share context for the reviewer."
                />
              </label>
              <div className="mt-4">
                <Button type="button" onClick={() => void submitAccountRequest()} disabled={requestBusy}>
                  {requestBusy ? "Submitting…" : "Submit request"}
                </Button>
                {requestMessage ? <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{requestMessage}</p> : null}
              </div>

              <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-600 dark:text-zinc-500">
                  My request history
                </h3>
                <div className="mt-3 space-y-2">
                  {requestHistory.length === 0 ? (
                    <p className="text-sm text-zinc-600 dark:text-zinc-500">No requests submitted yet.</p>
                  ) : (
                    requestHistory.map((r) => (
                      <div key={r.id} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
                        <span className="font-medium">{r.requestType}</span> · {r.status} ·{" "}
                        {new Date(r.createdAt).toLocaleString()}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </article>
          </section>
        ) : (
          <PlaceholderSection title={tabs.find((t) => t.id === tab)?.label ?? "Section"} />
        )}

        {tab === "profile" ? null : (
          <div className="flex flex-wrap gap-3 border-t border-zinc-200 pt-8 dark:border-zinc-800">
            <Button
              type="button"
              variant="outline"
              className="rounded-full border-zinc-300 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              onClick={() => void signOut({ callbackUrl: "/signin" })}
            >
              Sign out
            </Button>
          </div>
        )}
      </div>
    </Tabs>
  );
}

function PlaceholderSection({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-100 p-10 text-center dark:border-zinc-700 dark:bg-zinc-950/30">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        This section is not configured yet. Critical account controls stay under Profile and your authentication
        provider.
      </p>
    </div>
  );
}
