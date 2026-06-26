// Composio HTTP adapter — no SDK dependency, calls Composio REST API directly.
// Full docs: https://docs.composio.dev/api-reference

const BASE_URL = "https://backend.composio.dev/api/v2";

export interface ComposioConnection {
  id: string;
  appName: string;
  status: string;
  createdAt: string;
}

export interface ComposioActionResult {
  data: Record<string, unknown>;
  error?: string;
  successfull: boolean;
}

async function composioFetch(
  apiKey: string,
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Composio API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function executeAction(
  apiKey: string,
  actionName: string,
  input: Record<string, unknown>,
  connectedAccountId?: string
): Promise<ComposioActionResult> {
  const body: Record<string, unknown> = { input };
  if (connectedAccountId) body.connectedAccountId = connectedAccountId;

  const result = await composioFetch(apiKey, `/actions/${actionName}/execute`, {
    method: "POST",
    body: JSON.stringify(body),
  }) as { data?: Record<string, unknown>; error?: string; successfull?: boolean };

  return {
    data: result.data ?? {},
    error: result.error,
    successfull: result.successfull !== false,
  };
}

export async function listConnections(apiKey: string): Promise<ComposioConnection[]> {
  const result = await composioFetch(apiKey, "/connections") as {
    items?: Array<{ id: string; appName: string; status: string; createdAt: string }>;
  };
  return (result.items ?? []).map(c => ({
    id: c.id,
    appName: c.appName,
    status: c.status,
    createdAt: c.createdAt,
  }));
}

export async function getConnectionForApp(
  apiKey: string,
  appName: string
): Promise<ComposioConnection | null> {
  const connections = await listConnections(apiKey);
  return connections.find(c => c.appName.toLowerCase() === appName.toLowerCase()) ?? null;
}

export async function initiateOAuthConnection(
  apiKey: string,
  appName: string,
  redirectUrl?: string
): Promise<{ connectionId: string; redirectUrl: string }> {
  const result = await composioFetch(apiKey, "/connections", {
    method: "POST",
    body: JSON.stringify({
      appName,
      ...(redirectUrl ? { redirectUri: redirectUrl } : {}),
    }),
  }) as { connectionId?: string; id?: string; redirectUrl?: string };

  return {
    connectionId: result.connectionId ?? result.id ?? "",
    redirectUrl: result.redirectUrl ?? "",
  };
}

export async function testApiKey(apiKey: string): Promise<{ valid: boolean; email?: string }> {
  try {
    const result = await composioFetch(apiKey, "/client/auth/client_info") as {
      client?: { userEmail?: string };
    };
    return { valid: true, email: result.client?.userEmail };
  } catch {
    return { valid: false };
  }
}

// Canonical Composio action names for common SaaS operations
export const COMPOSIO_ACTIONS = {
  slack: {
    send_message: "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
    create_channel: "SLACK_CREATE_CHANNEL",
    get_messages: "SLACK_FETCH_CONVERSATION_HISTORY",
  },
  gmail: {
    send_email: "GMAIL_SEND_EMAIL",
    read_inbox: "GMAIL_FETCH_EMAILS",
    create_draft: "GMAIL_CREATE_EMAIL_DRAFT",
  },
  notion: {
    create_page: "NOTION_CREATE_PAGE",
    search: "NOTION_SEARCH",
    update_page: "NOTION_UPDATE_PAGE",
  },
  hubspot: {
    create_contact: "HUBSPOT_CREATE_CONTACT",
    create_deal: "HUBSPOT_CREATE_DEAL",
    get_contacts: "HUBSPOT_LIST_CONTACTS",
  },
  stripe: {
    create_invoice: "STRIPE_CREATE_INVOICE",
    list_customers: "STRIPE_LIST_CUSTOMERS",
    get_balance: "STRIPE_RETRIEVE_BALANCE",
  },
  github: {
    create_issue: "GITHUB_CREATE_AN_ISSUE",
    comment_on_issue: "GITHUB_ADDS_A_COMMENT_ON_AN_ISSUE",
    create_pr: "GITHUB_CREATE_A_PULL_REQUEST",
  },
  googlecalendar: {
    create_event: "GOOGLECALENDAR_CREATE_EVENT",
    list_events: "GOOGLECALENDAR_LIST_EVENTS",
    update_event: "GOOGLECALENDAR_UPDATE_EVENT",
    delete_event: "GOOGLECALENDAR_DELETE_EVENT",
  },
  googledrive: {
    create_file: "GOOGLEDRIVE_CREATE_FILE",
    upload_file: "GOOGLEDRIVE_UPLOAD_FILE",
    list_files: "GOOGLEDRIVE_LIST_FILES",
  },
  linear: {
    create_issue: "LINEAR_CREATE_ISSUE",
    update_issue: "LINEAR_UPDATE_ISSUE",
    list_issues: "LINEAR_LIST_ISSUES",
  },
  jira: {
    create_issue: "JIRA_CREATE_ISSUE",
    update_issue: "JIRA_UPDATE_ISSUE",
    add_comment: "JIRA_ADD_COMMENT",
  },
} as const;
