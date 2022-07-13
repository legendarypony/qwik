import { component$, Host, useStyles$ } from '@builder.io/qwik';
import { useLocation } from '~qwik-city-runtime';
import styles from './header.css?inline';

export default component$(
  () => {
    useStyles$(styles);

    const pathname = useLocation().pathname;

    return (
      <Host>
        <section class="logo">
          <a href="/">Qwik City 🏙</a>
        </section>
        <nav>
          <a href="/blog" class={{ active: pathname.startsWith('/blog') }}>
            Blog
          </a>
          <a href="/docs" class={{ active: pathname.startsWith('/docs') }}>
            Docs
          </a>
          <a href="/api" class={{ active: pathname.startsWith('/api') }}>
            API
          </a>
          <a href="/products/hat" class={{ active: pathname.startsWith('/products') }}>
            Products
          </a>
          <a href="/about-us" class={{ active: pathname.startsWith('/about-us') }}>
            About Us
          </a>
          <a href="/sign-in" class={{ active: pathname.startsWith('/sign-in') }}>
            Sign In
          </a>
        </nav>
      </Host>
    );
  },
  {
    tagName: 'header',
  }
);
