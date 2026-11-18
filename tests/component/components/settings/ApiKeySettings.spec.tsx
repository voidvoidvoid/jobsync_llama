import { render, screen, waitFor } from "@testing-library/react";
import ApiKeySettings from "@/components/settings/ApiKeySettings";
import { AiProvider } from "@/models/ai.model";

const getUserApiKeys = vi.fn();
const getDefaultOllamaBaseUrl = vi.fn();
const deleteApiKey = vi.fn();
const getUserSettings = vi.fn();
const checkOllamaConnection = vi.fn();

vi.mock("@/actions/apiKey.actions", () => ({
  getUserApiKeys: () => getUserApiKeys(),
  saveApiKey: vi.fn(),
  deleteApiKey: (provider: string) => deleteApiKey(provider),
  getDefaultOllamaBaseUrl: () => getDefaultOllamaBaseUrl(),
  getDefaultLlamacppBaseUrl: () => Promise.resolve("http://127.0.0.1:8080"),
}));

vi.mock("@/actions/userSettings.actions", () => ({
  getUserSettings: () => getUserSettings(),
}));

vi.mock("@/utils/ai.utils", () => ({
  checkOllamaConnection: (provider: AiProvider) =>
    checkOllamaConnection(provider),
}));

vi.mock("@/lib/toast", () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

function settingsFor(provider: AiProvider) {
  return {
    success: true,
    data: { userId: "u1", settings: { ai: { provider }, display: {} } },
  };
}

describe("ApiKeySettings — Ollama connection probe", () => {
  beforeEach(() => {
    getUserApiKeys.mockResolvedValue({ success: true, data: [] });
    getDefaultOllamaBaseUrl.mockResolvedValue("http://127.0.0.1:11434");
    checkOllamaConnection.mockResolvedValue({ isConnected: true });
  });

  it("does not probe Ollama when another provider is selected", async () => {
    getUserSettings.mockResolvedValue(settingsFor(AiProvider.OPENROUTER));

    render(<ApiKeySettings />);

    await waitFor(() => expect(getUserSettings).toHaveBeenCalled());
    expect(checkOllamaConnection).not.toHaveBeenCalled();
    expect(screen.queryByText(/Ollama is (not )?running/)).toBeNull();
  });

  it("probes Ollama when it is the selected provider", async () => {
    getUserSettings.mockResolvedValue(settingsFor(AiProvider.OLLAMA));

    render(<ApiKeySettings />);

    await waitFor(() =>
      expect(screen.getByText("Ollama is running")).toBeInTheDocument(),
    );
    expect(checkOllamaConnection).toHaveBeenCalledWith(AiProvider.OLLAMA);
  });
});

describe("ApiKeySettings — llama.cpp", () => {
  beforeEach(() => {
    getUserApiKeys.mockResolvedValue({ success: true, data: [] });
    getDefaultOllamaBaseUrl.mockResolvedValue("http://127.0.0.1:11434");
    checkOllamaConnection.mockReset();
    checkOllamaConnection.mockResolvedValue({ isConnected: true });
  });

  it("lists the base URL card followed by its optional API key card", async () => {
    getUserSettings.mockResolvedValue(settingsFor(AiProvider.OPENROUTER));

    render(<ApiKeySettings />);

    const url = await screen.findByText("llama.cpp (OpenAI-compatible)");
    const key = screen.getByText("llama.cpp API key (optional)");
    expect(
      url.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("probes the server when llama.cpp is the selected provider", async () => {
    getUserSettings.mockResolvedValue(settingsFor(AiProvider.LLAMACPP));

    render(<ApiKeySettings />);

    await waitFor(() =>
      expect(screen.getByText("The server is running")).toBeInTheDocument(),
    );
    expect(checkOllamaConnection).toHaveBeenCalledWith(AiProvider.LLAMACPP);
    expect(checkOllamaConnection).not.toHaveBeenCalledWith(AiProvider.OLLAMA);
  });
});

describe("ApiKeySettings — clearing a stored base URL", () => {
  beforeEach(() => {
    getUserApiKeys.mockResolvedValue({
      success: true,
      data: [
        {
          id: "k1",
          provider: "ollama",
          last4: "http://box:11434",
          displayValue: "http://box:11434",
          label: null,
          createdAt: new Date(),
          lastUsedAt: null,
        },
      ],
    });
    getDefaultOllamaBaseUrl.mockResolvedValue("http://127.0.0.1:11434");
    getUserSettings.mockResolvedValue(settingsFor(AiProvider.OPENROUTER));
    checkOllamaConnection.mockResolvedValue({ isConnected: false });
  });

  it("offers a labelled reset that names the server default", async () => {
    render(<ApiKeySettings />);

    await waitFor(() =>
      expect(screen.getByText("Reset to default")).toBeInTheDocument(),
    );
  });
});
