interface CommandRequest {
  command: string;
  params?: Record<string, any>;
}

interface CommandResponse {
  success: boolean;
  message: string;
  data?: Record<string, any>;
}

const API_BASE_URL = 'http://127.0.0.1:8000/api';

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function sendCommand(command: string, params?: Record<string, any>): Promise<CommandResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command,
        params,
      } as CommandRequest),
    });

    if (!response.ok) {
      throw new ApiError(`API request failed: ${response.statusText}`, response.status);
    }

    const data = await response.json();
    return data as CommandResponse;
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(`Failed to send command: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) {
      return false;
    }
    const data = await response.json();
    return data.status === 'healthy';
  } catch (error) {
    return false;
  }
} 