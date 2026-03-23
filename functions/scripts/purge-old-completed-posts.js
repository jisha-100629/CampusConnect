const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const BOARD_IDS = ["cse", "cse-aiml", "ece", "eee", "it"];
const DEFAULT_DAYS = 30;
const DEFAULT_BATCH_SIZE = 300;
const DEFAULT_MAX_BATCHES = 10;

function readProjectId() {
  const envProject =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT;
  if (envProject) return envProject;

  const firebasercPath = path.resolve(__dirname, "..", "..", ".firebaserc");
  if (!fs.existsSync(firebasercPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(firebasercPath, "utf8"));
    return data?.projects?.default || null;
  } catch (error) {
    return null;
  }
}

function parseArgs(argv) {
  const options = {
    boardId: null,
    allBoards: false,
    days: DEFAULT_DAYS,
    dryRun: false,
    batchSize: DEFAULT_BATCH_SIZE,
    maxBatches: DEFAULT_MAX_BATCHES,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--board") {
      options.boardId = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--all") {
      options.allBoards = true;
      continue;
    }
    if (arg === "--days") {
      options.days = Number(argv[i + 1]) || DEFAULT_DAYS;
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--batch-size") {
      options.batchSize = Number(argv[i + 1]) || DEFAULT_BATCH_SIZE;
      i += 1;
      continue;
    }
    if (arg === "--max-batches") {
      options.maxBatches = Number(argv[i + 1]) || DEFAULT_MAX_BATCHES;
      i += 1;
      continue;
    }
    if (arg === "--help") {
      options.help = true;
      continue;
    }
  }

  return options;
}

function printHelp() {
  console.log("Usage:");
  console.log("  node scripts/purge-old-completed-posts.js --board cse");
  console.log("  node scripts/purge-old-completed-posts.js --all");
  console.log("");
  console.log("Options:");
  console.log("  --board <id>       Board id to clean");
  console.log("  --all              Clean all boards");
  console.log("  --days <n>          Age threshold in days (default 30)");
  console.log("  --dry-run           Show counts without deleting");
  console.log("  --batch-size <n>    Deletes per batch (default 300)");
  console.log("  --max-batches <n>   Max batches per board (default 10)");
  console.log("");
  console.log("Credentials:");
  console.log("  Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON.");
}

async function cleanupBoard(db, boardId, options, cutoffTimestamp) {
  let deletedCount = 0;
  for (let batchIndex = 0; batchIndex < options.maxBatches; batchIndex += 1) {
    const snapshot = await db
      .collection("posts")
      .where("boardId", "==", boardId)
      .where("lifecycleStatus", "==", "completed")
      .where("completedAt", "<=", cutoffTimestamp)
      .orderBy("completedAt", "desc")
      .limit(options.batchSize)
      .get();

    if (snapshot.empty) break;

    if (!options.dryRun) {
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }

    deletedCount += snapshot.size;

    if (snapshot.size < options.batchSize) break;
  }

  return deletedCount;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || (!options.allBoards && !options.boardId)) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const projectId = readProjectId();
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: projectId || undefined,
  });

  const db = admin.firestore();
  const cutoffDate = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
  const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoffDate);

  const boardsToClean = options.allBoards ? BOARD_IDS : [options.boardId];
  let totalDeleted = 0;

  for (const boardId of boardsToClean) {
    const deletedCount = await cleanupBoard(db, boardId, options, cutoffTimestamp);
    totalDeleted += deletedCount;
    console.log(
      `${boardId}: ${options.dryRun ? "would remove" : "removed"} ${deletedCount} completed post(s)`
    );
  }

  console.log(
    `Total ${options.dryRun ? "eligible" : "deleted"}: ${totalDeleted} (cutoff ${cutoffDate.toISOString()})`
  );
}

run().catch((error) => {
  console.error("Cleanup failed:", error?.message || error);
  process.exit(1);
});
