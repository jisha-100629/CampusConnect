import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { getToken } from "firebase/messaging";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import {
  ALLOWED_DOMAIN,
  auth,
  db,
  getMessagingIfSupported,
  isAllowedEmail,
  provider,
  storage,
} from "./firebase";
import "./App.css";

const VIEW = {
  WELCOME: "welcome",
  LOGIN: "login",
  DASHBOARD: "dashboard",
};

const DASHBOARD_PAGE = {
  HOME: "home",
  DEPARTMENT: "department",
  CALENDAR: "calendar",
  FAQ: "faq",
  PROFILE: "profile",
  STARRED: "starred",
  REMINDERS: "reminders",
};

const FEED_TAB = {
  FEED: "feed",
  COMPLETED: "completed",
  PENDING: "pending",
};

const BOARDS = [
  {
    id: "cse",
    name: "Computer Science Engineering",
    shortName: "CSE",
    thumbnail:
      "https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "cse-aiml",
    name: "CSE (AI & ML)",
    shortName: "CSE-AIML",
    thumbnail:
      "https://images.unsplash.com/photo-1555949963-aa79dcee981c?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "ece",
    name: "Electronics & Communication",
    shortName: "ECE",
    thumbnail:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "eee",
    name: "Electrical & Electronics",
    shortName: "EEE",
    thumbnail:
      "https://images.unsplash.com/photo-1509395176047-4a66953fd231?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "it",
    name: "Information Technology",
    shortName: "IT",
    thumbnail:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80",
  },
];

const STUDENT_YEAR_BY_PREFIX = {
  "25": 1,
  "24": 2,
  "23": 3,
  "22": 4,
};

const PRIORITY_RANK = {
  high: 1,
  medium: 2,
  low: 3,
};

const POST_TYPES = ["notice", "event", "hackathon", "workshop", "announcement"];
const PRIORITY_OPTIONS = ["high", "medium", "low"];
const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;
const UPLOAD_IDLE_TIMEOUT_MS = 90000;
const UPLOAD_MAX_TIMEOUT_MS = 300000;
const PUBLISH_TIMEOUT_MS = 90000;
const FAQ_RECIPIENTS = [
  "Admin",
  "CSE Faculty",
  "CSE-AIML Faculty",
  "ECE Faculty",
  "EEE Faculty",
  "IT Faculty",
];
const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseEmailIdentity(email) {
  const localPart = (email || "").split("@")[0]?.toLowerCase() || "";
  const startsWithDigit = /^[0-9]/.test(localPart);

  if (startsWithDigit) {
    const prefix = localPart.slice(0, 2);
    return {
      role: "student",
      year: STUDENT_YEAR_BY_PREFIX[prefix] ?? null,
      authorApproved: false,
    };
  }

  return {
    role: "faculty",
    year: null,
    authorApproved: true,
  };
}

function toStatusMessage(error, fallback) {
  const code = error?.code || "";
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("image upload timed out")) {
    return "Image upload timed out. Try a smaller image or a stronger connection.";
  }
  if (message.includes("publishing timed out")) {
    return "Publishing timed out. Please retry once your connection is stable.";
  }
  if (code === "permission-denied") {
    return "You are signed in, but Firestore permissions are denying access.";
  }
  if (code === "storage/unauthorized") {
    return "Image upload denied by Firebase Storage rules. Deploy storage rules: firebase deploy --only storage --project campusconnect-55cca";
  }
  if (code === "storage/unauthenticated") {
    return "Upload failed because your session expired. Please log out and sign in again.";
  }
  if (code === "storage/quota-exceeded") {
    return "Firebase Storage quota exceeded for this project.";
  }
  if (code === "storage/retry-limit-exceeded") {
    return "Upload timed out due to network issues. Try again with a smaller image.";
  }
  if (code === "storage/canceled") {
    return "Upload canceled.";
  }
  if (code === "storage/unknown") {
    return "Image upload failed. Check internet and ensure Firebase Storage is enabled for project campusconnect-55cca.";
  }
  if (code === "deadline-exceeded") {
    return "Request timed out. Please try again with a smaller image or better network.";
  }
  if (message.includes("timed out")) {
    return "Request timed out. Please try again with a smaller image or better network.";
  }
  return error?.message || fallback;
}

function getPriorityRank(value) {
  return PRIORITY_RANK[value] || PRIORITY_RANK.medium;
}

function tokenizeText(value) {
  return Array.from(
    new Set(
      (value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 1)
    )
  ).slice(0, 40);
}

function formatTimestamp(value) {
  if (!value) return "Just now";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDateTimeLocal(value) {
  if (!value) return "";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (input) => String(input).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatDateLabel(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function getDateKey(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function getInitials(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "CC";
  const parts = cleaned.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "CC";
}

function isVisibleForYear(post, yearValue) {
  if (!yearValue) return true;
  if (Array.isArray(post.audienceYears) && post.audienceYears.length > 0) {
    return post.audienceYears.includes(yearValue);
  }
  if (typeof post.year === "number") {
    return post.year === yearValue;
  }
  return true;
}

function computeUrgencyScore(priority, deadlineAt) {
  const priorityRank = getPriorityRank(priority);
  const fallbackDeadline = 9999999999999;
  const deadlineMs = deadlineAt ? deadlineAt.getTime() : fallbackDeadline;
  return priorityRank * 10000000000000 + deadlineMs;
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      const error = new Error(timeoutMessage);
      error.code = "deadline-exceeded";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timerId)),
    timeoutPromise,
  ]);
}

function uploadImageWithProgress(storageRef, file, onProgress, idleTimeoutMs = UPLOAD_IDLE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file);

    let idleTimerId = null;
    let maxTimerId = null;
    let settled = false;

    const clearTimers = () => {
      if (idleTimerId) clearTimeout(idleTimerId);
      if (maxTimerId) clearTimeout(maxTimerId);
    };

    const failUpload = (errorMessage) => {
      if (settled) return;
      settled = true;
      uploadTask.cancel();
      clearTimers();
      const error = new Error(errorMessage);
      error.code = "deadline-exceeded";
      reject(error);
    };

    const resetIdleTimer = () => {
      if (idleTimerId) clearTimeout(idleTimerId);
      idleTimerId = setTimeout(() => {
        failUpload("Image upload timed out");
      }, idleTimeoutMs);
    };

    maxTimerId = setTimeout(() => {
      failUpload("Image upload timed out");
    }, UPLOAD_MAX_TIMEOUT_MS);

    resetIdleTimer();

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        if (!snapshot.totalBytes) return;
        resetIdleTimer();
        const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        onProgress(progress);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(error);
      },
      async () => {
        if (settled) return;
        settled = true;
        clearTimers();
        try {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(url);
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}

function isModerator(profile) {
  if (!profile) return false;
  return profile.role === "admin" || profile.role === "faculty";
}

function getTokenDocId(uid, token) {
  const safe = token.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  return `${uid}_${safe || "token"}`;
}

function getMessagingServiceWorkerUrl() {
  const params = new URLSearchParams({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  });

  const hasMissingValue = Array.from(params.values()).some((value) => !value);
  if (hasMissingValue) return null;

  return `/firebase-messaging-sw.js?${params.toString()}`;
}

export default function App() {
  const [view, setView] = useState(VIEW.LOGIN);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [authUser, setAuthUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [theme, setTheme] = useState("campus");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [dashboardPage, setDashboardPage] = useState(DASHBOARD_PAGE.HOME);
  const [selectedBoardId, setSelectedBoardId] = useState(BOARDS[0].id);
  const [activeTab, setActiveTab] = useState(FEED_TAB.FEED);
  const [posts, setPosts] = useState([]);
  const [completedPosts, setCompletedPosts] = useState([]);
  const [pendingPosts, setPendingPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [submittingPost, setSubmittingPost] = useState(false);
  const [approvingPostId, setApprovingPostId] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeFile, setComposeFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pushRegistered, setPushRegistered] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterYear, setFilterYear] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [readStatsByPost, setReadStatsByPost] = useState({});
  const [lightboxImage, setLightboxImage] = useState("");
  const [starredPosts, setStarredPosts] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [reminderDraft, setReminderDraft] = useState({
    postId: "",
    title: "",
    date: "",
  });
  const [reminderOpen, setReminderOpen] = useState(false);
  const [faqDraft, setFaqDraft] = useState({
    recipient: FAQ_RECIPIENTS[0],
    question: "",
    relatedPostId: "",
  });
  const [faqItems, setFaqItems] = useState([]);
  const [calendarCursor, setCalendarCursor] = useState(() => new Date());
  const [calendarSelectedDate, setCalendarSelectedDate] = useState(null);
  const [authoredPosts, setAuthoredPosts] = useState([]);
  const [authoredLoading, setAuthoredLoading] = useState(false);
  const [editPost, setEditPost] = useState(null);
  const [editForm, setEditForm] = useState({
    title: "",
    content: "",
    category: "",
    priority: "medium",
    deadline: "",
  });
  const [composeForm, setComposeForm] = useState({
    title: "",
    content: "",
    type: "notice",
    category: "",
    priority: "medium",
    link: "",
    targetYear: "all",
    deadline: "",
    targetMode: "specific",
    targetBoardId: BOARDS[0].id,
  });

  const selectedBoard = useMemo(
    () => BOARDS.find((board) => board.id === selectedBoardId) || BOARDS[0],
    [selectedBoardId]
  );
  const statusClass = useMemo(() => (isError ? "status error" : "status success"), [isError]);
  const canModerate = isModerator(userProfile);
  const canCreateGlobalPost = Boolean(userProfile?.role === "faculty" || userProfile?.role === "admin" || userProfile?.authorApproved === true);
  const isStudent = userProfile?.role === "student";
  const canViewAuthorPosts = Boolean(
    userProfile?.role === "faculty" || userProfile?.role === "admin" || userProfile?.authorApproved === true
  );
  const faqLabel = isStudent ? "FAQs" : "Questions";
  const profileHandle = useMemo(() => {
    const handle = (email || "").split("@")[0];
    return handle || userProfile?.name || "Campus member";
  }, [email, userProfile]);

  const pageTitle = useMemo(() => {
    switch (dashboardPage) {
      case DASHBOARD_PAGE.HOME:
        return "Departments";
      case DASHBOARD_PAGE.DEPARTMENT:
        return selectedBoard?.name || "Department Feed";
      case DASHBOARD_PAGE.CALENDAR:
        return "Campus Calendar";
      case DASHBOARD_PAGE.FAQ:
        return faqLabel;
      case DASHBOARD_PAGE.PROFILE:
        return "My Profile";
      case DASHBOARD_PAGE.STARRED:
        return "Starred Posts";
      case DASHBOARD_PAGE.REMINDERS:
        return "Reminders";
      default:
        return "Dashboard";
    }
  }, [dashboardPage, selectedBoard, faqLabel]);

  const calendarSourcePosts = useMemo(() => {
    const items = [...posts, ...completedPosts];
    if (canModerate) {
      items.push(...pendingPosts);
    }
    return items;
  }, [posts, completedPosts, pendingPosts, canModerate]);

  const calendarEvents = useMemo(() => {
    const map = new Map();
    calendarSourcePosts.forEach((post) => {
      const rawDate = post.deadlineAt || post.createdAt;
      if (!rawDate) return;
      const date = rawDate?.toDate ? rawDate.toDate() : new Date(rawDate);
      if (Number.isNaN(date.getTime())) return;
      const key = getDateKey(date);
      if (!key) return;
      const entry = {
        id: post.id,
        title: post.title || "Untitled",
        type: post.type || "notice",
        priority: post.priority || "medium",
        boardName: post.boardName || selectedBoard?.shortName || "",
        date,
        deadlineAt: post.deadlineAt || null,
      };
      const bucket = map.get(key) || [];
      bucket.push(entry);
      map.set(key, bucket);
    });
    return map;
  }, [calendarSourcePosts, selectedBoard]);

  const calendarDays = useMemo(() => {
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const offset = firstDay.getDay();
    const totalCells = Math.ceil((offset + lastDay.getDate()) / 7) * 7;
    return Array.from({ length: totalCells }, (_, index) => {
      const dayNumber = index - offset + 1;
      const date = new Date(year, month, dayNumber);
      return {
        date,
        inMonth: dayNumber >= 1 && dayNumber <= lastDay.getDate(),
      };
    });
  }, [calendarCursor]);

  const selectedCalendarKey = calendarSelectedDate ? getDateKey(calendarSelectedDate) : "";
  const selectedDayEvents = useMemo(() => {
    if (!selectedCalendarKey) return [];
    return calendarEvents.get(selectedCalendarKey) || [];
  }, [calendarEvents, selectedCalendarKey]);
  const starredPostIds = useMemo(() => new Set(starredPosts.map((post) => post.id)), [starredPosts]);

  const allCategoryValues = useMemo(() => {
    const values = [...posts, ...completedPosts, ...pendingPosts]
      .map((item) => (item.category || "").toLowerCase().trim())
      .filter(Boolean);
    return Array.from(new Set(values)).sort();
  }, [posts, completedPosts, pendingPosts]);

  function resetComposeForm() {
    setComposeForm({
      title: "",
      content: "",
      type: "notice",
      category: "",
      priority: "medium",
      link: "",
      targetYear: "all",
      deadline: "",
      targetMode: "specific",
      targetBoardId: selectedBoardId,
    });
    setComposeFile(null);
    setUploadProgress(0);
  }

  function clearFilters() {
    setSearchTerm("");
    setFilterType("all");
    setFilterPriority("all");
    setFilterYear("all");
    setFilterCategory("all");
  }

  function navigateTo(page) {
    setDashboardPage(page);
    setProfileMenuOpen(false);
  }

  function toggleTheme() {
    setTheme((prev) => (prev === "campus" ? "sunset" : "campus"));
  }

  function toggleStar(post) {
    setStarredPosts((prev) => {
      const exists = prev.find((item) => item.id === post.id);
      if (exists) {
        return prev.filter((item) => item.id !== post.id);
      }
      return [
        {
          id: post.id,
          title: post.title || "Untitled",
          content: post.content || "",
          type: post.type || "notice",
          boardName: post.boardName || selectedBoard?.shortName || "",
          priority: post.priority || "medium",
          mediaUrls: post.mediaUrls || [],
          createdAt: post.createdAt || null,
        },
        ...prev,
      ];
    });
  }

  function openReminder(post) {
    setReminderDraft({
      postId: post.id,
      title: post.title || "Untitled",
      date: "",
    });
    setReminderOpen(true);
  }

  function saveReminder() {
    if (!reminderDraft.postId || !reminderDraft.date) {
      setIsError(true);
      setStatus("Select a reminder date.");
      return;
    }

    setReminders((prev) => [
      {
        id: `${reminderDraft.postId}-${reminderDraft.date}`,
        postId: reminderDraft.postId,
        title: reminderDraft.title,
        remindAt: reminderDraft.date,
      },
      ...prev,
    ]);
    setReminderOpen(false);
    setReminderDraft({ postId: "", title: "", date: "" });
    setIsError(false);
    setStatus("Reminder saved.");
  }

  function removeReminder(reminderId) {
    setReminders((prev) => prev.filter((item) => item.id !== reminderId));
  }

  function openFaqForPost(post) {
    setFaqDraft((prev) => ({
      ...prev,
      question: `Question about: ${post.title || "this post"}`,
      relatedPostId: post.id,
    }));
    navigateTo(DASHBOARD_PAGE.FAQ);
  }

  function handleFaqSubmit(event) {
    event.preventDefault();
    if (!faqDraft.question.trim()) {
      setIsError(true);
      setStatus("Please write your question.");
      return;
    }
    const entry = {
      id: `${Date.now()}`,
      question: faqDraft.question.trim(),
      recipient: faqDraft.recipient,
      relatedPostId: faqDraft.relatedPostId,
      createdAt: new Date().toISOString(),
      status: "Pending",
    };
    setFaqItems((prev) => [entry, ...prev]);
    setFaqDraft((prev) => ({ ...prev, question: "", relatedPostId: "" }));
    setIsError(false);
    setStatus("Question sent.");
  }

  function applyFilters(list) {
    const keyword = searchTerm.toLowerCase().trim();
    const selectedYear = filterYear === "all" ? null : Number(filterYear);

    return list.filter((post) => {
      if (filterType !== "all" && post.type !== filterType) return false;
      if (filterPriority !== "all" && post.priority !== filterPriority) return false;
      if (filterCategory !== "all" && (post.category || "").toLowerCase() !== filterCategory) return false;
      if (selectedYear && !isVisibleForYear(post, selectedYear)) return false;

      if (!keyword) return true;
      const haystack = `${post.title || ""} ${post.content || ""} ${post.category || ""}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }

  const filteredFeedPosts = useMemo(() => applyFilters(posts), [
    posts,
    searchTerm,
    filterType,
    filterPriority,
    filterYear,
    filterCategory,
  ]);
  const filteredCompletedPosts = useMemo(() => applyFilters(completedPosts), [
    completedPosts,
    searchTerm,
    filterType,
    filterPriority,
    filterYear,
    filterCategory,
  ]);
  const filteredPendingPosts = useMemo(() => applyFilters(pendingPosts), [
    pendingPosts,
    searchTerm,
    filterType,
    filterPriority,
    filterYear,
    filterCategory,
  ]);

  async function writeAuditLog(action, targetId, boardId, metadata = {}) {
    if (!authUser) return;
    try {
      await addDoc(collection(db, "auditLogs"), {
        actorUid: authUser.uid,
        actorEmail: authUser.email || "",
        actorRole: userProfile?.role || "student",
        action,
        targetType: "post",
        targetId,
        boardId,
        metadata,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      // Non-blocking.
    }
  }

  async function registerPushToken(user, profile) {
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey || pushRegistered) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;

      const messaging = await getMessagingIfSupported();
      if (!messaging) return;

      const messagingSwUrl = getMessagingServiceWorkerUrl();
      if (!messagingSwUrl) return;

      const swRegistration = await navigator.serviceWorker.register(messagingSwUrl);
      const token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: swRegistration,
      });

      if (!token) return;

      await setDoc(
        doc(db, "notificationTokens", getTokenDocId(user.uid, token)),
        {
          uid: user.uid,
          email: user.email || "",
          token,
          role: profile.role || "student",
          year: profile.year ?? null,
          boardSubscriptions: ["all"],
          notificationsEnabled: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setPushRegistered(true);
    } catch (error) {
      // Non-blocking.
    }
  }

  async function syncUserProfile(user) {
    const inferredIdentity = parseEmailIdentity(user.email || "");
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      const defaultProfile = {
        uid: user.uid,
        name: user.displayName || "",
        email: user.email || "",
        role: inferredIdentity.role,
        department: "",
        year: inferredIdentity.year,
        authorApproved: inferredIdentity.authorApproved,
        createdAt: serverTimestamp(),
      };

      await setDoc(userRef, defaultProfile);
      return defaultProfile;
    }

    const existing = userSnap.data();
    const isAdminUser = existing.role === "admin";
    const nextRole = isAdminUser ? "admin" : inferredIdentity.role;
    const nextYear = isAdminUser ? existing.year ?? null : inferredIdentity.year;
    const nextAuthorApproved = isAdminUser
      ? existing.authorApproved === true
      : inferredIdentity.role === "faculty"
      ? true
      : existing.authorApproved === true;

    await setDoc(
      userRef,
      {
        uid: user.uid,
        name: user.displayName || existing.name || "",
        email: user.email || existing.email || "",
        role: nextRole,
        year: nextYear,
        authorApproved: nextAuthorApproved,
      },
      { merge: true }
    );

    return {
      ...existing,
      uid: user.uid,
      name: user.displayName || existing.name || "",
      email: user.email || existing.email || "",
      role: nextRole,
      year: nextYear,
      authorApproved: nextAuthorApproved,
    };
  }

  async function ensureDefaultBoards(user) {
    await Promise.all(
      BOARDS.map((board) =>
        setDoc(
          doc(db, "boards", board.id),
          {
            boardId: board.id,
            name: board.name,
            active: true,
            createdBy: user.uid,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      )
    );
  }

  async function markFeedPostsRead(feedPosts, user, profile) {
    if (!user || feedPosts.length === 0) return;

    const trackingWrites = feedPosts.slice(0, 40).map((post) =>
      setDoc(
        doc(db, "postReads", `${post.id}_${user.uid}`),
        {
          postId: post.id,
          boardId: post.boardId,
          viewerUid: user.uid,
          viewerEmail: user.email || "",
          viewerYear: profile?.year ?? null,
          viewedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );

    try {
      await Promise.all(trackingWrites);
    } catch (error) {
      // Non-blocking.
    }
  }

  async function loadReadAnalytics(feedPosts) {
    if (!canModerate || feedPosts.length === 0) {
      setReadStatsByPost({});
      return;
    }

    try {
      const studentsSnapshot = await getDocs(query(collection(db, "users"), where("role", "==", "student")));
      const students = studentsSnapshot.docs.map((item) => item.data());

      const yearCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
      for (const student of students) {
        if (typeof student.year === "number" && yearCounts[student.year] !== undefined) {
          yearCounts[student.year] += 1;
        }
      }

      const allStudentsCount = students.length;
      const postStatsEntries = await Promise.all(
        feedPosts.slice(0, 20).map(async (post) => {
          const postReadsSnapshot = await getDocs(
            query(collection(db, "postReads"), where("postId", "==", post.id))
          );

          let eligibleCount = allStudentsCount;
          if (Array.isArray(post.audienceYears) && post.audienceYears.length > 0) {
            eligibleCount = post.audienceYears.reduce((sum, yearValue) => sum + (yearCounts[yearValue] || 0), 0);
          } else if (typeof post.year === "number") {
            eligibleCount = yearCounts[post.year] || 0;
          }

          const readCount = postReadsSnapshot.size;
          const readPercent = eligibleCount > 0 ? Math.round((readCount / eligibleCount) * 100) : 0;
          return [post.id, { readCount, eligibleCount, readPercent }];
        })
      );

      setReadStatsByPost(Object.fromEntries(postStatsEntries));
    } catch (error) {
      // Non-blocking.
    }
  }

  async function autoCompleteExpiredPosts(boardId) {
    if (!canModerate) return;
    try {
      const expiryQuery = query(
        collection(db, "posts"),
        where("boardId", "==", boardId),
        where("lifecycleStatus", "==", "active"),
        where("deadlineAt", "<=", Timestamp.now()),
        orderBy("deadlineAt", "asc"),
        limit(30)
      );
      const expiredSnapshot = await getDocs(expiryQuery);
      for (const item of expiredSnapshot.docs) {
        const data = item.data();
        if (data.visibility !== "published") continue;
        await updateDoc(doc(db, "posts", item.id), {
          lifecycleStatus: "completed",
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog("mark_completed", item.id, boardId, { automated: true });
      }
    } catch (error) {
      // Non-blocking.
    }
  }

  async function loadDepartmentData(boardId, profile, user, options = {}) {
    const silentErrors = options.silentErrors === true;
    setPostsLoading(true);
    try {
      await autoCompleteExpiredPosts(boardId);

      const feedQuery = query(
        collection(db, "posts"),
        where("boardId", "==", boardId),
        where("visibility", "==", "published"),
        where("lifecycleStatus", "==", "active"),
        orderBy("urgencyScore", "asc"),
        orderBy("createdAt", "desc"),
        limit(80)
      );

      const completedQuery = canModerate
        ? query(
            collection(db, "posts"),
            where("boardId", "==", boardId),
            where("lifecycleStatus", "==", "completed"),
            orderBy("completedAt", "desc"),
            limit(80)
          )
        : query(
            collection(db, "posts"),
            where("boardId", "==", boardId),
            where("visibility", "==", "published"),
            where("lifecycleStatus", "==", "completed"),
            orderBy("completedAt", "desc"),
            limit(80)
          );

      const pendingQuery = canModerate
        ? query(
            collection(db, "posts"),
            where("boardId", "==", boardId),
            where("approvalStatus", "==", "pending"),
            orderBy("createdAt", "desc"),
            limit(80)
          )
        : null;

      const [feedSnapshot, completedSnapshot, pendingSnapshot] = await Promise.all([
        getDocs(feedQuery),
        getDocs(completedQuery),
        pendingQuery ? getDocs(pendingQuery) : Promise.resolve(null),
      ]);

      const nextFeedPosts = feedSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      const nextCompletedPosts = completedSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.visibility === "published");
      const nextPendingPosts = pendingSnapshot
        ? pendingSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        : [];

      setPosts(nextFeedPosts);
      setCompletedPosts(nextCompletedPosts);
      setPendingPosts(nextPendingPosts);

      await markFeedPostsRead(nextFeedPosts, user, profile);
      await loadReadAnalytics(nextFeedPosts);
    } catch (error) {
      if (!silentErrors) {
        setIsError(true);
        setStatus(toStatusMessage(error, "Unable to load department posts."));
      }
    } finally {
      setPostsLoading(false);
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAuthUser(null);
        setUserProfile(null);
        setPushRegistered(false);
        setLoading(false);
        return;
      }

      const userEmail = user.email || "";
      if (!isAllowedEmail(userEmail)) {
        await signOut(auth);
        setIsError(true);
        setStatus(`Access denied: use your @${ALLOWED_DOMAIN} email.`);
        setView(VIEW.LOGIN);
        setEmail("");
        setUserProfile(null);
        setLoading(false);
        return;
      }

      try {
        const profile = await syncUserProfile(user);
        if (profile.role === "admin") {
          try {
            await ensureDefaultBoards(user);
          } catch (error) {
            // Non-blocking.
          }
        }

        setAuthUser(user);
        setEmail(userEmail);
        setUserProfile(profile);
        setDashboardPage(DASHBOARD_PAGE.HOME);
        setIsError(false);
        setStatus("Login successful.");
        setView(VIEW.DASHBOARD);
      } catch (error) {
        setIsError(true);
        setStatus(toStatusMessage(error, "Unable to load profile."));
        setView(VIEW.LOGIN);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authUser || !userProfile || pushRegistered === true) return;
    registerPushToken(authUser, userProfile);
  }, [authUser, userProfile, pushRegistered]);

  useEffect(() => {
    if (view !== VIEW.DASHBOARD || !authUser || !userProfile) {
      return;
    }
    if (dashboardPage !== DASHBOARD_PAGE.DEPARTMENT && dashboardPage !== DASHBOARD_PAGE.CALENDAR) {
      return;
    }
    loadDepartmentData(selectedBoardId, userProfile, authUser);
  }, [view, dashboardPage, selectedBoardId, authUser, userProfile]);

  useEffect(() => {
    if (dashboardPage === DASHBOARD_PAGE.CALENDAR && !calendarSelectedDate) {
      setCalendarSelectedDate(new Date());
    }
  }, [dashboardPage, calendarSelectedDate]);

  useEffect(() => {
    if (view !== VIEW.DASHBOARD || dashboardPage !== DASHBOARD_PAGE.PROFILE) return;
    if (!authUser || !userProfile || !canViewAuthorPosts) return;
    void loadAuthoredPosts();
  }, [view, dashboardPage, authUser, userProfile, canViewAuthorPosts]);

  async function handleGoogleLogin() {
    setIsError(false);
    setStatus("Signing in...");
    try {
      const result = await signInWithPopup(auth, provider);
      const userEmail = result.user?.email || "";
      if (!isAllowedEmail(userEmail)) {
        await signOut(auth);
        setIsError(true);
        setStatus(`Access denied: use your @${ALLOWED_DOMAIN} email.`);
        return;
      }
      const profile = await syncUserProfile(result.user);
      setAuthUser(result.user);
      setEmail(userEmail);
      setUserProfile(profile);
      setDashboardPage(DASHBOARD_PAGE.HOME);
      setIsError(false);
      setStatus("Login successful.");
      setView(VIEW.DASHBOARD);
    } catch (error) {
      setIsError(true);
      setStatus(toStatusMessage(error, "Login failed."));
    }
  }

  async function handleCreatePost() {
    if (!authUser || !userProfile) return;
    if (!canCreateGlobalPost) {
      setIsError(true);
      setStatus("Only approved authors can create posts from dashboard.");
      return;
    }

    const title = composeForm.title.trim();
    const content = composeForm.content.trim();
    const category = composeForm.category.trim().toLowerCase();
    const linkValue = composeForm.link.trim();

    if (!title || !content) {
      setIsError(true);
      setStatus("Please provide both title and message content.");
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setIsError(true);
      setStatus("You appear to be offline. Connect to internet and try again.");
      return;
    }

    if (composeFile && !String(composeFile.type || "").startsWith("image/")) {
      setIsError(true);
      setStatus("Only image files are allowed.");
      return;
    }

    if (composeFile && composeFile.size > MAX_UPLOAD_BYTES) {
      setIsError(true);
      setStatus("Image is too large. Please upload an image below 7 MB.");
      return;
    }

    const deadlineDate = composeForm.deadline ? new Date(composeForm.deadline) : null;
    if (deadlineDate && Number.isNaN(deadlineDate.getTime())) {
      setIsError(true);
      setStatus("Invalid deadline format.");
      return;
    }

    const targetYear = composeForm.targetYear === "all" ? null : Number(composeForm.targetYear);
    if (targetYear && ![1, 2, 3, 4].includes(targetYear)) {
      setIsError(true);
      setStatus("Target year must be 1, 2, 3, or 4.");
      return;
    }

    const targetBoardIds =
      composeForm.targetMode === "all" ? BOARDS.map((board) => board.id) : [composeForm.targetBoardId];

    const contentWithLink = linkValue ? `${content}\n\nLink: ${linkValue}` : content;

    setSubmittingPost(true);
    setUploadProgress(0);
    setIsError(false);
    setStatus("Publishing post...");

    try {
      let mediaUrl = "";
      if (composeFile) {
        const safeName = composeFile.name.replace(/\s+/g, "-");
        const storageRef = ref(storage, `posts/${authUser.uid}/${Date.now()}-${safeName}`);
        setStatus("Uploading image... 0%");
        mediaUrl = await uploadImageWithProgress(storageRef, composeFile, (progress) => {
          setUploadProgress(progress);
          if (progress < 100) {
            setStatus(`Uploading image... ${progress}%`);
          }
        }, UPLOAD_IDLE_TIMEOUT_MS);
        setStatus("Publishing post...");
      }

      const urgencyScore = computeUrgencyScore(composeForm.priority, deadlineDate);

      await withTimeout(Promise.all(
        targetBoardIds.map(async (boardId) => {
          const board = BOARDS.find((item) => item.id === boardId);
          const postRef = await addDoc(collection(db, "posts"), {
            boardId,
            boardName: board?.name || boardId,
            type: composeForm.type,
            category: category || "",
            title,
            content: contentWithLink,
            mediaUrls: mediaUrl ? [mediaUrl] : [],
            priority: composeForm.priority,
            priorityRank: getPriorityRank(composeForm.priority),
            urgencyScore,
            year: targetYear,
            audienceYears: targetYear ? [targetYear] : [],
            searchTokens: tokenizeText(`${title} ${contentWithLink} ${category} ${composeForm.type}`),
            deadlineAt: deadlineDate ? Timestamp.fromDate(deadlineDate) : null,
            completedAt: null,
            lifecycleStatus: "active",
            visibility: "published",
            approvalStatus: "approved",
            authorUid: authUser.uid,
            authorName: authUser.displayName || "",
            authorEmail: authUser.email || "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          await writeAuditLog("create_post", postRef.id, boardId, {
            targetMode: composeForm.targetMode,
            priority: composeForm.priority,
          });
        })
      ), PUBLISH_TIMEOUT_MS, "Publishing timed out");

      resetComposeForm();
      setComposeOpen(false);
      if (dashboardPage === DASHBOARD_PAGE.DEPARTMENT && targetBoardIds.includes(selectedBoardId)) {
        void loadDepartmentData(selectedBoardId, userProfile, authUser, { silentErrors: true });
      }
      setStatus(
        composeForm.targetMode === "all"
          ? "Post published to all departments."
          : "Post published to selected department."
      );
    } catch (error) {
      setIsError(true);
      setStatus(toStatusMessage(error, "Unable to create post."));
    } finally {
      setSubmittingPost(false);
    }
  }

  function openEditPost(post) {
    setEditPost(post);
    setEditForm({
      title: post.title || "",
      content: post.content || "",
      category: post.category || "",
      priority: post.priority || "medium",
      deadline: post.deadlineAt ? formatDateTimeLocal(post.deadlineAt) : "",
    });
  }

  function closeEditPost() {
    setEditPost(null);
    setEditForm({
      title: "",
      content: "",
      category: "",
      priority: "medium",
      deadline: "",
    });
  }

  async function handleSaveEdit() {
    if (!editPost) return;
    const title = editForm.title.trim();
    const content = editForm.content.trim();
    const category = editForm.category.trim().toLowerCase();

    if (!title || !content) {
      setIsError(true);
      setStatus("Title and content are required.");
      return;
    }

    const deadlineDate = editForm.deadline ? new Date(editForm.deadline) : null;
    if (deadlineDate && Number.isNaN(deadlineDate.getTime())) {
      setIsError(true);
      setStatus("Invalid deadline format.");
      return;
    }

    try {
      await updateDoc(doc(db, "posts", editPost.id), {
        title,
        content,
        category: category || "",
        priority: editForm.priority,
        priorityRank: getPriorityRank(editForm.priority),
        urgencyScore: computeUrgencyScore(editForm.priority, deadlineDate),
        deadlineAt: deadlineDate ? Timestamp.fromDate(deadlineDate) : null,
        searchTokens: tokenizeText(`${title} ${content} ${category} ${editPost.type || ""}`),
        updatedAt: serverTimestamp(),
      });
      setIsError(false);
      setStatus("Post updated.");
      closeEditPost();
      await loadAuthoredPosts();
    } catch (error) {
      setIsError(true);
      setStatus(toStatusMessage(error, "Unable to update post."));
    }
  }

  async function handleDeletePost(post) {
    if (!post) return;
    const ok = window.confirm("Delete this post? This cannot be undone.");
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "posts", post.id));
      setIsError(false);
      setStatus("Post deleted.");
      setAuthoredPosts((prev) => prev.filter((item) => item.id !== post.id));
    } catch (error) {
      setIsError(true);
      setStatus(toStatusMessage(error, "Unable to delete post."));
    }
  }

  async function loadAuthoredPosts() {
    if (!authUser || !canViewAuthorPosts) return;
    setAuthoredLoading(true);
    try {
      const authoredQuery = query(
        collection(db, "posts"),
        where("authorUid", "==", authUser.uid),
        orderBy("createdAt", "desc"),
        limit(80)
      );
      const snapshot = await getDocs(authoredQuery);
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      setAuthoredPosts(items);
      await loadReadAnalytics(items);
    } catch (error) {
      setIsError(true);
      setStatus(toStatusMessage(error, "Unable to load your posts."));
    } finally {
      setAuthoredLoading(false);
    }
  }

  async function handleApproval(postId, action) {
    if (!canModerate || !postId) return;
    const isApprove = action === "approve";
    setApprovingPostId(postId);
    setIsError(false);
    setStatus(isApprove ? "Approving post..." : "Rejecting post...");

    try {
      await updateDoc(doc(db, "posts", postId), {
        visibility: isApprove ? "published" : "rejected",
        approvalStatus: isApprove ? "approved" : "rejected",
        updatedAt: serverTimestamp(),
        approvedByUid: authUser.uid,
        approvedAt: serverTimestamp(),
      });
      await writeAuditLog(isApprove ? "approve_post" : "reject_post", postId, selectedBoard.id, {});
      await loadDepartmentData(selectedBoard.id, userProfile, authUser);
      setStatus(isApprove ? "Post approved." : "Post rejected.");
    } catch (error) {
      setIsError(true);
      setStatus(toStatusMessage(error, "Unable to update approval status."));
    } finally {
      setApprovingPostId("");
    }
  }

  async function handleLogout() {
    await signOut(auth);
    setAuthUser(null);
    setEmail("");
    setUserProfile(null);
    setPosts([]);
    setCompletedPosts([]);
    setPendingPosts([]);
    setReadStatsByPost({});
    setDashboardPage(DASHBOARD_PAGE.HOME);
    setSelectedBoardId(BOARDS[0].id);
    setActiveTab(FEED_TAB.FEED);
    setPushRegistered(false);
    clearFilters();
    setComposeOpen(false);
    setProfileMenuOpen(false);
    setStarredPosts([]);
    setReminders([]);
    setReminderDraft({ postId: "", title: "", date: "" });
    setReminderOpen(false);
    setLightboxImage("");
    setFaqDraft({ recipient: FAQ_RECIPIENTS[0], question: "", relatedPostId: "" });
    setFaqItems([]);
    setCalendarSelectedDate(null);
    setAuthoredPosts([]);
    setAuthoredLoading(false);
    setEditPost(null);
    setIsError(false);
    setStatus("Logged out successfully.");
    setView(VIEW.LOGIN);
  }

  function openDepartment(boardId) {
    setSelectedBoardId(boardId);
    setComposeForm((prev) => ({ ...prev, targetBoardId: boardId, targetMode: "specific" }));
    setActiveTab(FEED_TAB.FEED);
    clearFilters();
    setDashboardPage(DASHBOARD_PAGE.DEPARTMENT);
    setProfileMenuOpen(false);
    setStatus("");
    setIsError(false);
  }

  function handleBoardSelect(event) {
    const nextBoardId = event.target.value;
    setSelectedBoardId(nextBoardId);
    setComposeForm((prev) => ({ ...prev, targetBoardId: nextBoardId }));
  }

  function shiftCalendar(monthDelta) {
    setCalendarCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + monthDelta, 1));
  }

  if (loading) {
    return (
      <main className="app-shell app-shell-loading">
        <section className="surface-card card-loading">
          <p className="description">Loading CampusConnect...</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${theme === "sunset" ? "theme-sunset" : "theme-campus"}`}>
      <div className="bg-orb orb-one" aria-hidden="true" />
      <div className="bg-orb orb-two" aria-hidden="true" />

      {view === VIEW.LOGIN && (
        <section className="auth-split" aria-hidden="false">
          <div className="auth-visual">
            <div className="auth-text">
              <p className="eyebrow">CampusConnect</p>
              <h1 className="hero-title">Your campus, connected in one clear feed.</h1>
              <p className="description">
                CampusConnect keeps every department update, event, and deadline in one place so students never miss a chance.
              </p>
              <div className="auth-highlights">
                <div className="highlight-item">Department announcements, verified.</div>
                <div className="highlight-item">Events, deadlines, and reminders.</div>
                <div className="highlight-item">Questions answered by faculty.</div>
              </div>
            </div>
            <img
              src="https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80"
              alt="College student using a laptop"
              className="auth-illustration"
            />
          </div>
          <div className="auth-panel">
            <div className="auth-panel-card">
              <h2>Sign In</h2>
              <p className="description">Use your institutional Google account to enter CampusConnect.</p>
              <button className="primary-btn" onClick={handleGoogleLogin} type="button">
                Sign in with Google
              </button>
              <p className="domain-note">Only @{ALLOWED_DOMAIN} accounts are allowed.</p>
              <p className={statusClass} role="status" aria-live="polite">
                {status}
              </p>
            </div>
          </div>
        </section>
      )}

      {view === VIEW.DASHBOARD && (
        <section className="dashboard-shell" aria-hidden="false">
          <aside className="sidebar">
            <div className="brand-block">
              <div className="brand-badge">CC</div>
              <div>
                <p className="brand-name">CampusConnect</p>
                <p className="brand-tag">BVRITH Campus Network</p>
              </div>
            </div>

            <button
              className="profile-bar"
              type="button"
              onClick={() => setProfileMenuOpen((prev) => !prev)}
            >
              <span className="profile-handle">{profileHandle}</span>
              <span className={`profile-chevron ${profileMenuOpen ? "open" : ""}`} aria-hidden="true">
                v
              </span>
              <span className="avatar small">{getInitials(userProfile?.name || email)}</span>
            </button>

            {profileMenuOpen && (
              <div className="profile-menu">
                <button type="button" onClick={() => navigateTo(DASHBOARD_PAGE.PROFILE)}>
                  My Profile
                </button>
                {isStudent && (
                  <button type="button" onClick={() => navigateTo(DASHBOARD_PAGE.STARRED)}>
                    Starred
                  </button>
                )}
                {isStudent && (
                  <button type="button" onClick={() => navigateTo(DASHBOARD_PAGE.REMINDERS)}>
                    Reminders
                  </button>
                )}
                <button type="button" onClick={toggleTheme}>
                  Switch Background
                </button>
                <button type="button" className="danger" onClick={handleLogout}>
                  Logout
                </button>
              </div>
            )}

            <nav className="sidebar-nav">
              <button
                type="button"
                className={`nav-btn ${dashboardPage === DASHBOARD_PAGE.HOME ? "active" : ""}`}
                onClick={() => navigateTo(DASHBOARD_PAGE.HOME)}
              >
                <span className="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" role="presentation">
                    <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5z" />
                  </svg>
                </span>
                Home
              </button>
              <button
                type="button"
                className={`nav-btn ${dashboardPage === DASHBOARD_PAGE.CALENDAR ? "active" : ""}`}
                onClick={() => navigateTo(DASHBOARD_PAGE.CALENDAR)}
              >
                <span className="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" role="presentation">
                    <path d="M7 3v3m10-3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
                  </svg>
                </span>
                Calendar
              </button>
              <button
                type="button"
                className={`nav-btn ${dashboardPage === DASHBOARD_PAGE.FAQ ? "active" : ""}`}
                onClick={() => navigateTo(DASHBOARD_PAGE.FAQ)}
              >
                <span className="nav-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" role="presentation">
                    <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1z" />
                  </svg>
                </span>
                {faqLabel}
              </button>
              {canCreateGlobalPost && (
                <button
                  type="button"
                  className="nav-btn nav-create"
                  onClick={() => {
                    setComposeOpen(true);
                    setIsError(false);
                    setStatus("");
                  }}
                >
                  <span className="nav-icon nav-plus" aria-hidden="true">
                    +
                  </span>
                  New Post
                </button>
              )}
            </nav>

            <div className="sidebar-footer">
              <span className="sidebar-pill">Role: {userProfile?.role || "student"}</span>
              <span className="sidebar-pill">Year: {userProfile?.year ? `${userProfile.year}` : "NA"}</span>
            </div>
          </aside>

          <div className="main-panel">
            <header className="main-header">
              <div>
                <p className="eyebrow">Welcome, {userProfile?.name || "Campus member"}</p>
                <h2>{pageTitle}</h2>
                <p className="description">
                  {dashboardPage === DASHBOARD_PAGE.HOME &&
                    "Choose a department to see notices, events, and deadlines."}
                  {dashboardPage === DASHBOARD_PAGE.DEPARTMENT &&
                    "Stay updated with verified posts from your department."}
                  {dashboardPage === DASHBOARD_PAGE.CALENDAR &&
                    "Track upcoming events and deadlines by date."}
                  {dashboardPage === DASHBOARD_PAGE.FAQ &&
                    (isStudent
                      ? "Ask a question directly to admins or faculty."
                      : "Questions submitted by students appear here.")}
                  {dashboardPage === DASHBOARD_PAGE.PROFILE &&
                    "Review your profile details and contribution stats."}
                  {dashboardPage === DASHBOARD_PAGE.STARRED &&
                    "Quick access to the posts you marked."}
                  {dashboardPage === DASHBOARD_PAGE.REMINDERS &&
                    "Your saved reminders for important deadlines."}
                </p>
              </div>
              <div className="header-actions">
                {dashboardPage === DASHBOARD_PAGE.DEPARTMENT && (
                  <button
                    className="ghost-btn compact-btn"
                    onClick={() => navigateTo(DASHBOARD_PAGE.HOME)}
                    type="button"
                  >
                    Back to Departments
                  </button>
                )}
                {dashboardPage === DASHBOARD_PAGE.CALENDAR && (
                  <select value={selectedBoardId} onChange={handleBoardSelect}>
                    {BOARDS.map((board) => (
                      <option key={board.id} value={board.id}>
                        {board.shortName}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </header>

            {status && (
              <p className={statusClass} role="status" aria-live="polite">
                {status}
              </p>
            )}

            {dashboardPage === DASHBOARD_PAGE.HOME && (
              <div className="branch-grid">
                {BOARDS.map((board) => (
                  <button
                    key={board.id}
                    className="branch-card"
                    onClick={() => openDepartment(board.id)}
                    type="button"
                  >
                    <div className="branch-media">
                      <img src={board.thumbnail} alt={board.name} />
                      <span className="branch-chip">{board.shortName}</span>
                    </div>
                    <div className="branch-body">
                      <h3>{board.name}</h3>
                      <p>Explore notices, events, and updates from this department.</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {dashboardPage === DASHBOARD_PAGE.CALENDAR && (
              <div className="calendar-layout">
                <section className="panel-card calendar-card">
                  <header className="calendar-header">
                    <button className="ghost-btn icon-btn" type="button" onClick={() => shiftCalendar(-1)}>
                      Prev
                    </button>
                    <div>
                      <h3>{formatDateLabel(calendarCursor)}</h3>
                      <p className="description">Showing {selectedBoard?.shortName || "board"} schedule.</p>
                    </div>
                    <button className="ghost-btn icon-btn" type="button" onClick={() => shiftCalendar(1)}>
                      Next
                    </button>
                  </header>

                  <div className="calendar-weekdays">
                    {WEEK_DAYS.map((day) => (
                      <span key={day}>{day}</span>
                    ))}
                  </div>
                  <div className="calendar-grid">
                    {calendarDays.map((day) => {
                      const dayKey = getDateKey(day.date);
                      const dayEvents = calendarEvents.get(dayKey) || [];
                      const isSelected = selectedCalendarKey === dayKey;
                      const isToday = getDateKey(new Date()) === dayKey;
                      return (
                        <button
                          key={`${dayKey}-${day.inMonth ? "in" : "out"}`}
                          type="button"
                          className={`calendar-day ${day.inMonth ? "" : "muted"} ${isSelected ? "selected" : ""} ${
                            isToday ? "today" : ""
                          }`}
                          onClick={() => setCalendarSelectedDate(day.date)}
                        >
                          <span>{day.date.getDate()}</span>
                          <div className="calendar-dots">
                            {dayEvents.slice(0, 3).map((eventItem) => (
                              <span
                                key={`${dayKey}-${eventItem.id}`}
                                className={`calendar-dot ${eventItem.priority}`}
                              />
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="calendar-legend">
                    <span>
                      <span className="calendar-dot high" /> High Priority
                    </span>
                    <span>
                      <span className="calendar-dot medium" /> Medium Priority
                    </span>
                    <span>
                      <span className="calendar-dot low" /> Low Priority
                    </span>
                  </div>
                </section>

                <section className="panel-card calendar-events">
                  <h3>
                    {calendarSelectedDate
                      ? calendarSelectedDate.toLocaleDateString("en-IN", { dateStyle: "full" })
                      : "Select a date"}
                  </h3>
                  {selectedDayEvents.length === 0 && <p className="hint">No events or deadlines selected.</p>}
                  {selectedDayEvents.map((eventItem) => (
                    <article key={`${eventItem.id}-event`} className="event-card">
                      <div>
                        <h4>{eventItem.title}</h4>
                        <p className="event-meta">
                          {eventItem.boardName} - {eventItem.type}
                        </p>
                      </div>
                      <span className={`event-chip ${eventItem.priority}`}>{eventItem.priority}</span>
                    </article>
                  ))}
                </section>
              </div>
            )}

            {dashboardPage === DASHBOARD_PAGE.FAQ && (
              <div className="faq-layout">
                <section className="panel-card">
                  <h3>{isStudent ? "Ask a Question" : "Student Questions"}</h3>
                  {isStudent ? (
                    <form className="faq-form" onSubmit={handleFaqSubmit}>
                      <label>
                        Send to
                        <select
                          value={faqDraft.recipient}
                          onChange={(event) => setFaqDraft((prev) => ({ ...prev, recipient: event.target.value }))}
                        >
                          {FAQ_RECIPIENTS.map((recipient) => (
                            <option key={recipient} value={recipient}>
                              {recipient}
                            </option>
                          ))}
                        </select>
                      </label>
                      <textarea
                        placeholder="Write your question..."
                        value={faqDraft.question}
                        onChange={(event) => setFaqDraft((prev) => ({ ...prev, question: event.target.value }))}
                      />
                      <button className="primary-btn" type="submit">
                        Send Question
                      </button>
                    </form>
                  ) : (
                    <p className="description">Questions addressed to faculty will appear in this inbox.</p>
                  )}
                </section>

                <section className="panel-card">
                  <h3>{isStudent ? "Your Questions" : "Inbox"}</h3>
                  {faqItems.length === 0 && <p className="hint">No questions yet.</p>}
                  {faqItems.map((item) => (
                    <article key={item.id} className="faq-item">
                      <p className="faq-question">{item.question}</p>
                      <p className="faq-meta">
                        To: {item.recipient} - Status: {item.status}
                      </p>
                    </article>
                  ))}
                </section>
              </div>
            )}

            {dashboardPage === DASHBOARD_PAGE.PROFILE && (
              <div className="profile-layout">
                <section className="panel-card profile-card">
                  <div className="profile-head">
                    <span className="avatar large">{getInitials(userProfile?.name || email)}</span>
                    <div>
                      <h3>{userProfile?.name || "Campus member"}</h3>
                      <p className="description">{email}</p>
                    </div>
                  </div>
                  <div className="profile-grid">
                    <div>
                      <p className="profile-label">Role</p>
                      <p>{userProfile?.role || "student"}</p>
                    </div>
                    <div>
                      <p className="profile-label">Year</p>
                      <p>{userProfile?.year || "NA"}</p>
                    </div>
                    <div>
                      <p className="profile-label">Department</p>
                      <p>{userProfile?.department || "Not set"}</p>
                    </div>
                    <div>
                      <p className="profile-label">Approved Poster</p>
                      <p>{userProfile?.authorApproved ? "Yes" : "No"}</p>
                    </div>
                  </div>
                </section>

                {canViewAuthorPosts ? (
                  <section className="panel-card">
                    <div className="section-head-row">
                      <h3>Your Posts</h3>
                      <span className="hint">{authoredPosts.length} total</span>
                    </div>
                    {authoredLoading && <p className="hint">Loading your posts...</p>}
                    {!authoredLoading && authoredPosts.length === 0 && (
                      <p className="hint">You have not posted yet.</p>
                    )}
                    {authoredPosts.length > 0 && (
                      <div className="post-list">
                        {authoredPosts.map((post) => {
                          const canDelete =
                            userProfile?.role === "admin" || post.visibility === "pending";
                          return (
                            <article key={post.id} className="post-card">
                              <header className="post-header">
                                <div>
                                  <p className="post-meta">
                                    Posted by {userProfile?.name || "You"} -{" "}
                                    {post.boardName || selectedBoard?.shortName || "Board"}
                                  </p>
                                  <h4>{post.title}</h4>
                                </div>
                                <div className="badge-row">
                                  <span className="post-badge">{post.type}</span>
                                  <span className={`priority-badge ${post.priority || "medium"}`}>
                                    {post.priority || "medium"}
                                  </span>
                                  {post.category && <span className="post-badge soft">{post.category}</span>}
                                </div>
                              </header>
                              {Array.isArray(post.mediaUrls) && post.mediaUrls[0] && (
                                <div className="post-media-wrap">
                                  <img
                                    src={post.mediaUrls[0]}
                                    alt={post.title || "Post media"}
                                    className="post-media"
                                    onClick={() => setLightboxImage(post.mediaUrls[0])}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        setLightboxImage(post.mediaUrls[0]);
                                      }
                                    }}
                                  />
                                </div>
                              )}
                              <p>{post.content}</p>
                              <div className="post-actions">
                                <button className="action-btn" type="button" onClick={() => openEditPost(post)}>
                                  Edit
                                </button>
                                <button
                                  className="action-btn danger"
                                  type="button"
                                  onClick={() => handleDeletePost(post)}
                                  disabled={!canDelete}
                                >
                                  Delete
                                </button>
                              </div>
                              <footer className="post-footer">
                                <p className="post-time">{formatTimestamp(post.createdAt)}</p>
                                {post.deadlineAt && <p>Deadline: {formatTimestamp(post.deadlineAt)}</p>}
                                {canModerate && readStatsByPost[post.id] ? (
                                  <p>
                                    Views {readStatsByPost[post.id].readCount}/{readStatsByPost[post.id].eligibleCount}
                                  </p>
                                ) : (
                                  <p>Views: restricted</p>
                                )}
                              </footer>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ) : (
                  <section className="panel-card">
                    <h3>Student Overview</h3>
                    <div className="stat-grid">
                      <div>
                        <p className="profile-label">Starred</p>
                        <p>{starredPosts.length}</p>
                      </div>
                      <div>
                        <p className="profile-label">Reminders</p>
                        <p>{reminders.length}</p>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}

            {dashboardPage === DASHBOARD_PAGE.STARRED && (
              <section className="panel-card">
                <div className="section-head-row">
                  <h3>Starred Posts</h3>
                  <span className="hint">{starredPosts.length} saved</span>
                </div>
                {starredPosts.length === 0 && <p className="hint">No starred posts yet.</p>}
                {starredPosts.length > 0 && (
                  <div className="post-list">
                    {starredPosts.map((post) => (
                      <article key={post.id} className="post-card">
                        <header className="post-header">
                          <div>
                            <p className="post-meta">{post.boardName || "Board"}</p>
                            <h4>{post.title}</h4>
                          </div>
                          <span className={`priority-badge ${post.priority || "medium"}`}>
                            {post.priority || "medium"}
                          </span>
                        </header>
                        {Array.isArray(post.mediaUrls) && post.mediaUrls[0] && (
                          <div className="post-media-wrap">
                            <img
                              src={post.mediaUrls[0]}
                              alt={post.title || "Post media"}
                              className="post-media"
                              onClick={() => setLightboxImage(post.mediaUrls[0])}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  setLightboxImage(post.mediaUrls[0]);
                                }
                              }}
                            />
                          </div>
                        )}
                        <p>{post.content}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}

            {dashboardPage === DASHBOARD_PAGE.REMINDERS && (
              <section className="panel-card">
                <div className="section-head-row">
                  <h3>Reminders</h3>
                  <span className="hint">{reminders.length} scheduled</span>
                </div>
                <div className="reminders-list">
                  {reminders.length === 0 && <p className="hint">No reminders set yet.</p>}
                  {reminders.map((reminder) => (
                    <article key={reminder.id} className="reminder-card">
                      <div>
                        <h4>{reminder.title}</h4>
                        <p className="reminder-meta">
                          Remind on {new Date(reminder.remindAt).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </p>
                      </div>
                      <button className="ghost-btn" type="button" onClick={() => removeReminder(reminder.id)}>
                        Remove
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {dashboardPage === DASHBOARD_PAGE.DEPARTMENT && (
              <div className="department-page">
                <div className="feed-tabs">
                  <button
                    type="button"
                    className={activeTab === FEED_TAB.FEED ? "tab-btn active" : "tab-btn"}
                    onClick={() => setActiveTab(FEED_TAB.FEED)}
                  >
                    Feed
                  </button>
                  <button
                    type="button"
                    className={activeTab === FEED_TAB.COMPLETED ? "tab-btn active" : "tab-btn"}
                    onClick={() => setActiveTab(FEED_TAB.COMPLETED)}
                  >
                    Completed
                  </button>
                  {canModerate && (
                    <button
                      type="button"
                      className={activeTab === FEED_TAB.PENDING ? "tab-btn active" : "tab-btn"}
                      onClick={() => setActiveTab(FEED_TAB.PENDING)}
                    >
                      Pending
                    </button>
                  )}
                </div>

                <div className="filters-panel">
                  <input
                    type="text"
                    placeholder="Search posts..."
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                  <select value={filterType} onChange={(event) => setFilterType(event.target.value)}>
                    <option value="all">All Types</option>
                    {POST_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <select value={filterPriority} onChange={(event) => setFilterPriority(event.target.value)}>
                    <option value="all">All Priority</option>
                    {PRIORITY_OPTIONS.map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                  <select value={filterYear} onChange={(event) => setFilterYear(event.target.value)}>
                    <option value="all">All Years</option>
                    <option value="1">1st Year</option>
                    <option value="2">2nd Year</option>
                    <option value="3">3rd Year</option>
                    <option value="4">4th Year</option>
                  </select>
                  <select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)}>
                    <option value="all">All Categories</option>
                    {allCategoryValues.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>

                {postsLoading && <p className="hint">Loading posts...</p>}

                {!postsLoading && activeTab === FEED_TAB.FEED && (
                  <div className="post-list">
                    {filteredFeedPosts.length === 0 && <p className="hint">No active posts found.</p>}
                    {filteredFeedPosts.map((post) => (
                      <article key={post.id} className="post-card">
                        <header className="post-header">
                          <div>
                            <p className="post-meta">
                              Posted by {post.authorName || post.authorEmail || "Home"} - {selectedBoard?.shortName || ""}
                            </p>
                            <h4>{post.title}</h4>
                          </div>
                          <div className="badge-row">
                            <span className="post-badge">{post.type}</span>
                            <span className={`priority-badge ${post.priority || "medium"}`}>
                              {post.priority || "medium"}
                            </span>
                            {post.category && <span className="post-badge soft">{post.category}</span>}
                          </div>
                        </header>

                        {Array.isArray(post.mediaUrls) && post.mediaUrls[0] && (
                          <div className="post-media-wrap">
                            <img
                              src={post.mediaUrls[0]}
                              alt={post.title || "Post media"}
                              className="post-media"
                              onClick={() => setLightboxImage(post.mediaUrls[0])}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  setLightboxImage(post.mediaUrls[0]);
                                }
                              }}
                            />
                          </div>
                        )}

                        <p>{post.content}</p>

                        <div className="post-actions">
                          <button
                            type="button"
                            className={`action-btn ${starredPostIds.has(post.id) ? "active" : ""}`}
                            onClick={() => toggleStar(post)}
                          >
                            {starredPostIds.has(post.id) ? "Starred" : "Star"}
                          </button>
                          {isStudent && (
                            <button type="button" className="action-btn" onClick={() => openReminder(post)}>
                              Reminder
                            </button>
                          )}
                          {isStudent && (
                            <button type="button" className="action-btn" onClick={() => openFaqForPost(post)}>
                              Ask
                            </button>
                          )}
                        </div>

                        <footer className="post-footer">
                          <p className="post-time">{formatTimestamp(post.createdAt)}</p>
                          {post.deadlineAt && <p>Deadline: {formatTimestamp(post.deadlineAt)}</p>}
                          {canModerate && readStatsByPost[post.id] && (
                            <p>
                              Read {readStatsByPost[post.id].readCount}/{readStatsByPost[post.id].eligibleCount} ({
                                readStatsByPost[post.id].readPercent
                              }%)
                            </p>
                          )}
                        </footer>
                      </article>
                    ))}
                  </div>
                )}

                {!postsLoading && activeTab === FEED_TAB.COMPLETED && (
                  <div className="post-list">
                    {filteredCompletedPosts.length === 0 && <p className="hint">No completed posts yet.</p>}
                    {filteredCompletedPosts.map((post) => (
                      <article key={post.id} className="post-card completed">
                        <h4>{post.title}</h4>
                        <p>{post.content}</p>
                      </article>
                    ))}
                  </div>
                )}

                {!postsLoading && activeTab === FEED_TAB.PENDING && canModerate && (
                  <div className="post-list">
                    {filteredPendingPosts.length === 0 && <p className="hint">No pending posts for approval.</p>}
                    {filteredPendingPosts.map((post) => (
                      <article key={post.id} className="post-card pending">
                        <h4>{post.title}</h4>
                        <p>{post.content}</p>
                        <footer className="pending-actions">
                          <button
                            type="button"
                            className="approve-btn"
                            disabled={approvingPostId === post.id}
                            onClick={() => handleApproval(post.id, "approve")}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="reject-btn"
                            disabled={approvingPostId === post.id}
                            onClick={() => handleApproval(post.id, "reject")}
                          >
                            Reject
                          </button>
                        </footer>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canCreateGlobalPost && (
              <button
                type="button"
                className="compose-fab"
                onClick={() => {
                  setComposeOpen(true);
                  setIsError(false);
                  setStatus("");
                }}
                aria-label="Create a post"
                title="Create a post"
              >
                +
              </button>
            )}
          </div>
        </section>
      )}

      {reminderOpen && (
        <div className="compose-overlay" role="dialog" aria-modal="true" aria-label="Set reminder">
          <section className="compose-modal reminder-modal">
            <h3>Set Reminder</h3>
            <p className="description">Choose a date and time for this reminder.</p>
            <input
              type="datetime-local"
              value={reminderDraft.date}
              onChange={(event) => setReminderDraft((prev) => ({ ...prev, date: event.target.value }))}
            />
            <div className="compose-actions">
              <button className="primary-btn" onClick={saveReminder} type="button">
                Save Reminder
              </button>
              <button
                className="ghost-btn"
                onClick={() => {
                  setReminderOpen(false);
                  setReminderDraft({ postId: "", title: "", date: "" });
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}

      {editPost && (
        <div className="compose-overlay" role="dialog" aria-modal="true" aria-label="Edit post">
          <section className="compose-modal">
            <h3>Edit Post</h3>
            <p className="description">Update your post details.</p>
            <input
              type="text"
              placeholder="Title"
              value={editForm.title}
              onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))}
            />
            <textarea
              placeholder="Write your content..."
              value={editForm.content}
              onChange={(event) => setEditForm((prev) => ({ ...prev, content: event.target.value }))}
            />
            <div className="compose-grid">
              <input
                type="text"
                placeholder="Category"
                value={editForm.category}
                onChange={(event) => setEditForm((prev) => ({ ...prev, category: event.target.value }))}
              />
              <select
                value={editForm.priority}
                onChange={(event) => setEditForm((prev) => ({ ...prev, priority: event.target.value }))}
              >
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={editForm.deadline}
                onChange={(event) => setEditForm((prev) => ({ ...prev, deadline: event.target.value }))}
              />
            </div>
            <div className="compose-actions">
              <button className="primary-btn" onClick={handleSaveEdit} type="button">
                Save Changes
              </button>
              <button className="ghost-btn" onClick={closeEditPost} type="button">
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}

      {lightboxImage && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Image preview">
          <div className="lightbox-inner" role="document">
            <button className="ghost-btn lightbox-close" type="button" onClick={() => setLightboxImage("")}>
              Close
            </button>
            <img src={lightboxImage} alt="Post preview" />
          </div>
        </div>
      )}

      {composeOpen && (
        <div className="compose-overlay" role="dialog" aria-modal="true" aria-label="Create post">
          <section className="compose-modal">
            <h3>Create Post</h3>
            <p className="hint">Post for a specific department or all departments.</p>

            <input
              type="text"
              placeholder="Title"
              value={composeForm.title}
              onChange={(event) => setComposeForm((prev) => ({ ...prev, title: event.target.value }))}
            />

            <textarea
              placeholder="Write your content..."
              value={composeForm.content}
              onChange={(event) => setComposeForm((prev) => ({ ...prev, content: event.target.value }))}
            />

            <label className="file-label">
              Upload image
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setComposeFile(event.target.files?.[0] || null)}
              />
            </label>
            {composeFile && <p className="hint">Selected file: {composeFile.name}</p>}

            <div className="compose-grid">
              <select
                value={composeForm.targetMode}
                onChange={(event) => setComposeForm((prev) => ({ ...prev, targetMode: event.target.value }))}
              >
                <option value="specific">Specific Department</option>
                <option value="all">All Departments</option>
              </select>

              <select
                value={composeForm.targetBoardId}
                onChange={(event) => setComposeForm((prev) => ({ ...prev, targetBoardId: event.target.value }))}
                disabled={composeForm.targetMode === "all"}
              >
                {BOARDS.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.shortName}
                  </option>
                ))}
              </select>

              <select
                value={composeForm.type}
                onChange={(event) => setComposeForm((prev) => ({ ...prev, type: event.target.value }))}
              >
                {POST_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>

              <select
                value={composeForm.priority}
                onChange={(event) => setComposeForm((prev) => ({ ...prev, priority: event.target.value }))}
              >
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>

              <select
                value={composeForm.targetYear}
                onChange={(event) => setComposeForm((prev) => ({ ...prev, targetYear: event.target.value }))}
              >
                <option value="all">All Years</option>
                <option value="1">1st Year</option>
                <option value="2">2nd Year</option>
                <option value="3">3rd Year</option>
                <option value="4">4th Year</option>
              </select>

              <input
                type="text"
                placeholder="Category (optional)"
                value={composeForm.category}
                onChange={(event) => setComposeForm((prev) => ({ ...prev, category: event.target.value }))}
              />
            </div>

            <input
              type="text"
              placeholder="Optional link (https://...)"
              value={composeForm.link}
              onChange={(event) => setComposeForm((prev) => ({ ...prev, link: event.target.value }))}
            />

            <label className="deadline-label">
              Deadline (optional)
              <input
                type="datetime-local"
                value={composeForm.deadline}
                onChange={(event) => setComposeForm((prev) => ({ ...prev, deadline: event.target.value }))}
              />
            </label>

            <div className="compose-actions">
              <button className="primary-btn" onClick={handleCreatePost} disabled={submittingPost} type="button">
                {submittingPost
                  ? uploadProgress > 0 && uploadProgress < 100
                    ? `Saving ${uploadProgress}%...`
                    : "Saving..."
                  : "Post"}
              </button>
              <button
                className="ghost-btn"
                onClick={() => {
                  setComposeOpen(false);
                  resetComposeForm();
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
            <p className={`compose-status ${statusClass}`} role="status" aria-live="polite">
              {status}
            </p>
          </section>
        </div>
      )}
    </main>
  );
}





