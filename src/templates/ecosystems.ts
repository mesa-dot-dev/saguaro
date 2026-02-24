export interface EcosystemDetector {
  id: string;
  label: string;
  deps?: string[];
  files?: string[];
}

export const ECOSYSTEM_REGISTRY: EcosystemDetector[] = [
  {
    id: 'typescript',
    label: 'TypeScript',
    files: ['tsconfig.json', 'tsconfig.*.json'],
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    files: ['package.json'],
  },
  {
    id: 'python',
    label: 'Python',
    files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', '**/*.py'],
  },
  {
    id: 'go',
    label: 'Go',
    files: ['go.mod'],
  },
  {
    id: 'rust',
    label: 'Rust',
    files: ['Cargo.toml'],
  },
  {
    id: 'react',
    label: 'React',
    deps: ['react', 'react-dom', 'react-native'],
  },
  {
    id: 'node',
    label: 'Node.js',
    deps: ['express', 'hono', 'fastify', 'koa', '@nestjs/core'],
  },
  {
    id: 'sql',
    label: 'SQL',
    files: ['**/migrations/**/*.sql', '**/migrations/**/*.ts', '**/*.sql'],
  },
  {
    id: 'docker',
    label: 'Docker',
    files: ['Dockerfile', 'Dockerfile.*', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
  },
  {
    id: 'ci',
    label: 'CI/CD',
    files: ['.github/workflows/**/*.yml', '.github/workflows/**/*.yaml', '.gitlab-ci.yml', 'Jenkinsfile'],
  },
];
