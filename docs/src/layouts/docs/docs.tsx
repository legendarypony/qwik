import { $, component$, Host, Slot, useScopedStyles$ } from '@builder.io/qwik';
import { ContentNav } from '../../components/content-nav/content-nav';
import { Footer } from '../../components/footer/footer';
import { Header } from '../../components/header/header';
import { OnThisPage } from '../../components/on-this-page/on-this-page';
import { SideBar } from '../../components/sidebar/sidebar';
import styles from './docs.css';

const DocsLayout = component$(() => {
  useScopedStyles$(styles);

  return $(() => {
    return (
      <Host class="docs">
        <Header />
        <main>
          <SideBar />
          <article>
            <Slot />
            <ContentNav />
            <Footer />
          </article>
          <OnThisPage />
        </main>
      </Host>
    );
  });
});

export default DocsLayout;
