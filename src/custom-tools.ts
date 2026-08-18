export type Clause = {
  type: 'termination' | 'liability';
  text: string;
};

export const customToolDefinitions = [
  {
    name: 'identifyClauses',
    description: 'Classify the contract clauses supplied by the review workflow.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
  },
  {
    name: 'getPlaybookGuidance',
    description: 'Retrieve the organization’s guidance for a classified clause.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['clauseType'],
      properties: { clauseType: { type: 'string', enum: ['termination', 'liability'] } },
    },
  },
] as const;

export const customTools = {
  identifyClauses({ text }: { text: string }): Clause[] {
    const clauses: Clause[] = [];
    if (text.includes('Term and Termination')) {
      clauses.push({ type: 'termination', text: 'Either Party may terminate this Agreement upon thirty (30) days\' written notice.' });
    }
    if (text.includes('Indemnification')) {
      clauses.push({ type: 'liability', text: 'The total liability under this section shall not exceed $500,000.' });
    }
    return clauses;
  },

  getPlaybookGuidance({ clauseType }: { clauseType: Clause['type'] }) {
    if (clauseType === 'termination') {
      return {
        clauseType,
        instruction: 'Use the standard thirty-day notice language.',
        fallbackText: 'Either Party may terminate this Agreement with thirty (30) days\' written notice to the other Party.',
      };
    }
    return {
      clauseType,
      instruction: 'Escalate capped liability for legal review.',
      requiresHumanReview: true,
    };
  },
};

export type CustomToolName = keyof typeof customTools;
