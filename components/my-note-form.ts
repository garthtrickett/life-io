import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Effect, pipe } from 'effect';
import { clientLog } from '../lib/client/logger.client'; // Adjust path

@customElement('my-note-form')
export class MyNoteForm extends LitElement {
  @property({ type: String }) userId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; // Example user ID

  async createNote(title: string, content: string) {
    const noteData = {
      user_id: this.userId,
      title,
      content,
    };

    // Define the API call as an Effect
    const createNoteApiCall = Effect.tryPromise({
      try: () =>
        fetch('http://localhost:42069/note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(noteData),
        }).then(res => {
          if (!res.ok) throw new Error('Network response was not ok');
          return res.json();
        }),
      catch: (error) => new Error(`API Error: ${error instanceof Error ? error.message : 'Unknown fetch error'}`),
    });

    // Create a logging and execution pipeline
    const program = pipe(
      clientLog('info', `User attempting to create note: "${title}"`, this.userId, 'NoteCreation'),
      Effect.andThen(() => createNoteApiCall),
      Effect.tap((response) =>
        clientLog('info', `Successfully created note on server. Response: ${JSON.stringify(response)}`, this.userId, 'NoteCreation')
      ),
      Effect.catchAll((error) =>
        clientLog('error', `Failed to create note: ${error.message}`, this.userId, 'NoteCreation')
      )
    );

    // Execute the entire pipeline
    await Effect.runPromise(program);
  }

  render() {
    return html`
      <form @submit=${(e: Event) => {
        e.preventDefault();
        const formData = new FormData(e.target as HTMLFormElement);
        const title = formData.get('title') as string;
        const content = formData.get('content') as string;
        this.createNote(title, content);
      }}>
        <input name="title" placeholder="Note Title" required />
        <textarea name="content" placeholder="Note Content" required></textarea>
        <button type="submit">Create Note</button>
      </form>
    `;
  }
}
