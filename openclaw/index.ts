import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { createManageTool, createGenerateTool } from './src/tools.js';

const plugin = {
  id: 'openmaic',
  name: 'OpenMAIC',
  description: 'Manage and use OpenMAIC multi-agent interactive classroom',
  register(api: OpenClawPluginApi) {
    const url = (api.pluginConfig?.url as string) || 'http://localhost:3000';
    const projectDir = (api.pluginConfig?.projectDir as string) || '';

    api.registerTool(createManageTool({ url, projectDir }));
    api.registerTool(createGenerateTool({ url }));
  },
};

export default plugin;
