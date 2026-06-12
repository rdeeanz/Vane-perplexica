import { searchSearxng } from '@/lib/searxng';
import { getSearxngURL } from '@/lib/config/serverRegistry';

const websitesForTopic = {
  tech: {
    query: ['technology news', 'latest tech', 'AI', 'science and innovation'],
    links: ['techcrunch.com', 'wired.com', 'theverge.com'],
  },
  finance: {
    query: ['finance news', 'economy', 'stock market', 'investing'],
    links: ['bloomberg.com', 'cnbc.com', 'marketwatch.com'],
  },
  art: {
    query: ['art news', 'culture', 'modern art', 'cultural events'],
    links: ['artnews.com', 'hyperallergic.com', 'theartnewspaper.com'],
  },
  sports: {
    query: ['sports news', 'latest sports', 'cricket football tennis'],
    links: ['espn.com', 'bbc.com/sport', 'skysports.com'],
  },
  entertainment: {
    query: ['entertainment news', 'movies', 'TV shows', 'celebrities'],
    links: ['hollywoodreporter.com', 'variety.com', 'deadline.com'],
  },
};

const rssFeeds = {
  tech: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',
  finance: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
  art: 'https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml',
  sports: 'https://feeds.bbci.co.uk/sport/rss.xml',
  entertainment: 'https://rss.nytimes.com/services/xml/rss/nyt/Movies.xml',
};

const categoryPlaceholders = {
  tech: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop',
  finance: 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=600&auto=format&fit=crop',
  art: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=600&auto=format&fit=crop',
  sports: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=600&auto=format&fit=crop',
  entertainment: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&auto=format&fit=crop',
};

const cleanText = (str: string) => {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .trim();
};

type Topic = keyof typeof websitesForTopic;

const fetchRssFallback = async (topic: Topic, limit: number) => {
  const url = rssFeeds[topic];
  if (!url) return [];

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch RSS feed: ${res.statusText}`);
    }

    const xml = await res.text();
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    
    const blogs = items.slice(0, limit).map((item) => {
      const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
      const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);
      
      const mediaMatch = item.match(/<media:content[^>]+url=\"([^\"]+)\"/) ||
                         item.match(/<media:thumbnail[^>]+url=\"([^\"]+)\"/) ||
                         item.match(/<enclosure[^>]+url=\"([^\"]+)\"/);

      const title = cleanText(titleMatch?.[1] || '');
      const link = cleanText(linkMatch?.[1] || '');
      const content = cleanText(descMatch?.[1] || '');
      const thumbnail = mediaMatch?.[1] || categoryPlaceholders[topic];

      return {
        title,
        content,
        url: link,
        thumbnail,
      };
    }).filter(blog => blog.title && blog.url);

    return blogs;
  } catch (error) {
    console.error(`Error in fetchRssFallback for topic ${topic}:`, error);
    return [];
  }
};

export const GET = async (req: Request) => {
  try {
    const params = new URL(req.url).searchParams;
    const mode: 'normal' | 'preview' =
      (params.get('mode') as 'normal' | 'preview') || 'normal';
    const topic: Topic = (params.get('topic') as Topic) || 'tech';

    const limit = mode === 'preview' ? 3 : 15;
    const searxngURL = getSearxngURL();

    if (!searxngURL) {
      const blogs = await fetchRssFallback(topic, limit);
      return Response.json({ blogs }, { status: 200 });
    }

    const selectedTopic = websitesForTopic[topic];
    let data: any[] = [];

    try {
      if (mode === 'normal') {
        const seenUrls = new Set();
        data = (
          await Promise.all(
            selectedTopic.links.flatMap((link) =>
              selectedTopic.query.map(async (query) => {
                return (
                  await searchSearxng(`site:${link} ${query}`, {
                    engines: ['bing news'],
                    pageno: 1,
                    language: 'en',
                  })
                ).results;
              }),
            ),
          )
        )
          .flat()
          .filter((item) => {
            const url = item.url?.toLowerCase().trim();
            if (seenUrls.has(url)) return false;
            seenUrls.add(url);
            return true;
          })
          .sort(() => Math.random() - 0.5);
      } else {
        data = (
          await searchSearxng(
            `site:${selectedTopic.links[Math.floor(Math.random() * selectedTopic.links.length)]} ${selectedTopic.query[Math.floor(Math.random() * selectedTopic.query.length)]}`,
            {
              engines: ['bing news'],
              pageno: 1,
              language: 'en',
            },
          )
        ).results;
      }
    } catch (err) {
      console.warn(`SearXNG query failed, falling back to RSS feed: ${err}`);
    }

    if (!data || data.length === 0) {
      const blogs = await fetchRssFallback(topic, limit);
      return Response.json({ blogs }, { status: 200 });
    }

    return Response.json(
      {
        blogs: data,
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    console.error(`An error occurred in discover route: ${err}`);
    return Response.json(
      {
        message: 'An error has occurred',
      },
      {
        status: 500,
      },
    );
  }
};
