import OpenAILLM from '../openai/openaiLLM';
import { GenerateObjectInput } from '../../types';
import { parse } from 'partial-json';
import { repairJson } from '@toolsycc/json-repair';
import z from 'zod';

class DeepSeekLLM extends OpenAILLM {
  /**
   * DeepSeek does not support OpenAI's `json_schema` response_format or
   * `zodResponseFormat`. Instead, we use `json_object` mode and include
   * the schema description in the system prompt for guidance.
   */
  async generateObject<T>(input: GenerateObjectInput): Promise<T> {
    const jsonSchema = z.toJSONSchema(input.schema);

    const schemaInstruction = `You must respond with a valid JSON object that conforms to the following JSON schema:\n\`\`\`json\n${JSON.stringify(jsonSchema, null, 2)}\n\`\`\`\nDo not include any text outside the JSON object. Output only the JSON.`;

    const messages = [...input.messages];

    if (messages.length > 0 && messages[0].role === 'system') {
      messages[0] = {
        ...messages[0],
        content: messages[0].content + '\n\n' + schemaInstruction,
      };
    } else {
      messages.unshift({
        role: 'system',
        content: schemaInstruction,
      });
    }

    const response = await this.openAIClient.chat.completions.create({
      messages: this.convertToOpenAIMessages(messages),
      model: this.config.model,
      temperature:
        input.options?.temperature ?? this.config.options?.temperature ?? 1.0,
      top_p: input.options?.topP ?? this.config.options?.topP,
      max_completion_tokens:
        input.options?.maxTokens ?? this.config.options?.maxTokens,
      stop: input.options?.stopSequences ?? this.config.options?.stopSequences,
      frequency_penalty:
        input.options?.frequencyPenalty ??
        this.config.options?.frequencyPenalty,
      presence_penalty:
        input.options?.presencePenalty ?? this.config.options?.presencePenalty,
      response_format: { type: 'json_object' },
    });

    if (response.choices && response.choices.length > 0) {
      try {
        return input.schema.parse(
          JSON.parse(
            repairJson(response.choices[0].message.content!, {
              extractJson: true,
            }) as string,
          ),
        ) as T;
      } catch (err) {
        throw new Error(`Error parsing response from DeepSeek: ${err}`);
      }
    }

    throw new Error('No response from DeepSeek');
  }

  /**
   * DeepSeek does not support OpenAI's `responses.stream` API.
   * We use standard chat completions streaming with `json_object` mode instead.
   */
  async *streamObject<T>(input: GenerateObjectInput): AsyncGenerator<T> {
    const jsonSchema = z.toJSONSchema(input.schema);

    const schemaInstruction = `You must respond with a valid JSON object that conforms to the following JSON schema:\n\`\`\`json\n${JSON.stringify(jsonSchema, null, 2)}\n\`\`\`\nDo not include any text outside the JSON object. Output only the JSON.`;

    const messages = [...input.messages];

    if (messages.length > 0 && messages[0].role === 'system') {
      messages[0] = {
        ...messages[0],
        content: messages[0].content + '\n\n' + schemaInstruction,
      };
    } else {
      messages.unshift({
        role: 'system',
        content: schemaInstruction,
      });
    }

    let receivedObj = '';

    const stream = await this.openAIClient.chat.completions.create({
      model: this.config.model,
      messages: this.convertToOpenAIMessages(messages),
      temperature:
        input.options?.temperature ?? this.config.options?.temperature ?? 1.0,
      top_p: input.options?.topP ?? this.config.options?.topP,
      max_completion_tokens:
        input.options?.maxTokens ?? this.config.options?.maxTokens,
      stop: input.options?.stopSequences ?? this.config.options?.stopSequences,
      frequency_penalty:
        input.options?.frequencyPenalty ??
        this.config.options?.frequencyPenalty,
      presence_penalty:
        input.options?.presencePenalty ?? this.config.options?.presencePenalty,
      response_format: { type: 'json_object' },
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.choices && chunk.choices.length > 0) {
        const delta = chunk.choices[0].delta.content || '';
        receivedObj += delta;

        if (chunk.choices[0].finish_reason !== null) {
          try {
            yield input.schema.parse(JSON.parse(receivedObj)) as T;
          } catch (err) {
            throw new Error(`Error parsing response from DeepSeek: ${err}`);
          }
        } else {
          try {
            yield parse(receivedObj) as T;
          } catch {
            yield {} as T;
          }
        }
      }
    }
  }
}

export default DeepSeekLLM;
