import { component$, useSignal } from '@builder.io/qwik';
import { formAction$, useForm, zodForm$ } from '@modular-forms/qwik';
import Container from '~/components/container';
import { DiskIcon } from '~/components/icons/disk';
import Layout from '~/components/layout';
import { applicationTable, getDB } from '~/db';
import { appUrl } from '~/routes.config';
import { ApplicationForm } from '../[publicApiKey]/app.form';
import styles from './styles.module.css';

export const useFormAction = formAction$<ApplicationForm>(
  async ({ name, description, url }, { redirect }) => {
    const db = getDB();
    const publicApiKey = Math.round(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
    await db
      .insert(applicationTable)
      .values({
        name,
        description,
        publicApiKey,
        url: url,
      })
      .run();
    redirect(302, appUrl(`/app/[publicApiKey]/`, { publicApiKey }));
  },
  zodForm$(ApplicationForm)
);

export default component$(() => {
  const [, { Form, Field }] = useForm<ApplicationForm>({
    loader: useSignal({ name: '', description: '', url: '' }),
    action: useFormAction(),
    validate: zodForm$(ApplicationForm),
  });
  return (
    <Layout mode="bright">
      <Container position="center" width="small"></Container>
      <div class={styles['add-app-wrapper']}>
        <h1 class="h3">Create Application</h1>
        <Form>
          <div>
            <label>Name</label>
            <Field name="name">
              {(field, props) => (
                <>
                  <input {...props} type="text" value={field.value} />{' '}
                  {field.error && <div>{field.error}</div>}
                </>
              )}
            </Field>
          </div>
          <div>
            <label>Description</label>
            <Field name="description">
              {(field, props) => (
                <>
                  <input {...props} type="text" value={field.value} />{' '}
                  {field.error && <div>{field.error}</div>}
                </>
              )}
            </Field>
          </div>
          <div>
            <label>URL</label>
            <Field name="url">
              {(field, props) => (
                <>
                  <input {...props} type="text" value={field.value} />{' '}
                  {field.error && <div>{field.error}</div>}
                </>
              )}
            </Field>
          </div>
          <div
            style={{
              'margin-top': 'calc(var(--form-element-margin-bottom) * 2)',
            }}
          >
            <button type="submit" class="button">
              <DiskIcon />
              Create
            </button>
          </div>
        </Form>
      </div>
    </Layout>
  );
});
