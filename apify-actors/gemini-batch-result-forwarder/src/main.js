import { Actor } from "apify";

await Actor.main(async () => {
  const input = await Actor.getInput();
  if (!input) throw new Error("Missing actor input");

  const {
    gemini_api_key,
    gemini_batch_job_name,
    consumer_actor_id = "wavy_lilt/gemini-batch-webhook-consumer",
    supabase_url,
    supabase_service_role_key,
    boards,
    max_results = 25,
    posted_within = "Past 24 hours",
    linkedin_experience_level = "Mid-Senior",
    linkedin_employment_type = "",
    linkedin_work_arrangement = "",
    max_combinations = 90,
    max_concurrent = 10,
    batch_max_wait_minutes = 120,
    batch_poll_interval_seconds = 60,
    dry_run = false,
  } = input;

  if (!gemini_api_key) throw new Error("gemini_api_key is required");
  if (!gemini_batch_job_name) throw new Error("gemini_batch_job_name is required");
  if (!supabase_url || !supabase_service_role_key) {
    throw new Error("supabase_url and supabase_service_role_key are required inputs");
  }

  const batchMaxWaitMs = Math.max(1, Number(batch_max_wait_minutes) || 120) * 60 * 1000;
  const batchPollMs = Math.max(5, Number(batch_poll_interval_seconds) || 60) * 1000;

  console.log(`🚀 Gemini forwarder started for ${gemini_batch_job_name}`);

  const { batchJob, timedOut } = await waitForGeminiBatchCompletion({
    apiKey: gemini_api_key,
    batchJobName: gemini_batch_job_name,
    maxWaitMs: batchMaxWaitMs,
    pollIntervalMs: batchPollMs,
  });

  const stateName = getBatchStateName(batchJob);

  if (timedOut) {
    console.log(`⏳ Gemini batch timed out before completion: ${batchJob.name ?? gemini_batch_job_name}`);
    await Actor.setValue("OUTPUT", {
      ready: false,
      mode: "gemini_batch_forward",
      batch_job_name: batchJob.name ?? gemini_batch_job_name,
      batch_state: stateName,
      timed_out: true,
      note: "Batch did not complete within the wait window.",
    });
    return;
  }

  const outputFileName = resolveBatchOutputFileName(batchJob);
  if (!outputFileName) {
    throw new Error("Gemini batch completed but no output file reference was found on the batch job.");
  }

  const outputText = await fetchGeminiBatchOutputText({ apiKey: gemini_api_key, fileName: outputFileName });
  const geminiPayload = parseGeminiBatchOutput(outputText);

  console.log(`✅ Gemini batch completed and output parsed: ${batchJob.name ?? gemini_batch_job_name}`);

  const forwardPayload = {
    supabase_url,
    supabase_service_role_key,
    gemini_payload: geminiPayload,
    boards,
    max_results,
    posted_within,
    linkedin_experience_level,
    linkedin_employment_type,
    linkedin_work_arrangement,
    max_combinations,
    max_concurrent,
    dry_run,
  };

  const run = await Actor.call(consumer_actor_id, forwardPayload, {
    waitSecs: 120,
  });

  console.log(`✅ Forwarded Gemini payload to consumer actor: ${consumer_actor_id}`);

  await Actor.setValue("OUTPUT", {
    mode: "gemini_batch_forward",
    batch_job_name: batchJob.name ?? gemini_batch_job_name,
    batch_state: stateName,
    forwarded_to: consumer_actor_id,
    consumer_input: forwardPayload,
    consumer_run_id: run?.id ?? null,
    consumer_status: run?.status ?? null,
  });
});

async function fetchGeminiBatchJob({ apiKey, batchJobName }) {
  const normalizedName = String(batchJobName).startsWith("batches/")
    ? String(batchJobName)
    : `batches/${batchJobName}`;
  const encodedName = encodeResourceName(normalizedName);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${encodedName}?key=${apiKey}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch Gemini batch job ${normalizedName}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function waitForGeminiBatchCompletion({ apiKey, batchJobName, maxWaitMs, pollIntervalMs }) {
  const startedAt = Date.now();
  let batchJob = null;

  while (true) {
    try {
      batchJob = await fetchGeminiBatchJob({ apiKey, batchJobName: batchJob?.name ?? batchJobName });
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const is404 = String(err?.message ?? "").includes("404");
      if (is404 && elapsedMs < maxWaitMs) {
        console.log(`⏳ Gemini batch not visible yet (${batchJob?.name ?? batchJobName}); retrying in ${Math.round(pollIntervalMs / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        continue;
      }
      throw err;
    }

    const stateName = getBatchStateName(batchJob);
    if (isBatchSucceeded(stateName) || isBatchFailed(stateName)) {
      return { batchJob, timedOut: false };
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= maxWaitMs) {
      return { batchJob, timedOut: true };
    }

    console.log(`⏳ Waiting for Gemini batch ${batchJob.name ?? batchJobName} state=${stateName}`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    batchJob = await fetchGeminiBatchJob({ apiKey, batchJobName: batchJob.name ?? batchJobName });
  }
}

function getBatchStateName(batchJob) {
  return batchJob?.state?.name || batchJob?.state || batchJob?.status || "UNKNOWN";
}

function isBatchSucceeded(stateName) {
  return stateName === "JOB_STATE_SUCCEEDED" || stateName === "SUCCEEDED";
}

function isBatchFailed(stateName) {
  return ["JOB_STATE_FAILED", "FAILED", "JOB_STATE_CANCELLED", "CANCELLED"].includes(stateName);
}

function resolveBatchOutputFileName(batchJob) {
  return (
    batchJob?.dest?.fileName ||
    batchJob?.destination?.fileName ||
    batchJob?.output?.fileName ||
    batchJob?.output?.file?.name ||
    batchJob?.response?.fileName ||
    null
  );
}

function encodeResourceName(resourceName) {
  return String(resourceName)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function fetchGeminiBatchOutputText({ apiKey, fileName }) {
  const normalizedFileName = String(fileName).startsWith("files/") ? String(fileName) : `files/${fileName}`;
  const encoded = encodeResourceName(normalizedFileName);
  const urls = [
    `https://generativelanguage.googleapis.com/v1beta/${encoded}:download?alt=media&key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/${encoded}:download?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/${encoded}?alt=media&key=${apiKey}`,
  ];

  let lastError = "";
  for (const url of urls) {
    const res = await fetch(url);
    if (res.ok) return res.text();
    lastError = `${res.status} ${await res.text()}`;
  }

  throw new Error(`Failed to download Gemini batch output file ${normalizedFileName}: ${lastError}`);
}

function parseGeminiBatchOutput(outputText) {
  const lines = String(outputText).split("\n").map((line) => line.trim()).filter(Boolean);
  const selected = [];

  for (const line of lines) {
    let parsedLine;
    try {
      parsedLine = JSON.parse(line);
    } catch {
      continue;
    }

    const textCandidate =
      parsedLine?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      parsedLine?.response?.body?.candidates?.[0]?.content?.parts?.[0]?.text ||
      parsedLine?.result?.candidates?.[0]?.content?.parts?.[0]?.text ||
      parsedLine?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    if (!textCandidate) continue;

    const json = tryParseJson(textCandidate);
    if (!json) continue;

    if (Array.isArray(json.selected)) {
      selected.push(...json.selected);
    }
    if (Array.isArray(json.combinations)) {
      selected.push(...json.combinations);
    }
  }

  return { selected };
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
