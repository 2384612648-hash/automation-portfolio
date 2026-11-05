"""Curated public sources; user can disable or add feeds in the UI."""
TOPICS = {'world':'世界','china':'中国','economy':'经济与产业','robotics':'机器人与控制','ai':'AI 与计算','manufacturing':'制造与硬件','software':'软件与开源','tech':'科技综合','science':'科学研究','health':'健康','education':'教育与考研','general':'综合'}
SOURCE_KINDS = {'news':'新闻报道','official':'官方公告','research':'研究/预印本','community':'社区讨论','industry':'厂商/产业'}
DEFAULT_SOURCES = [
    ('cn-latest','中新网 · 即时','https://www.chinanews.com.cn/rss/scroll-news.xml','china','news',60),
    ('cn-world','中新网 · 国际','https://www.chinanews.com.cn/rss/world.xml','world','news',60),
    ('cn-economy','中新网 · 财经','https://www.chinanews.com.cn/rss/finance.xml','economy','news',60),
    ('ithome','IT之家','https://www.ithome.com/rss/','tech','news',60),
    ('bbc-world','BBC · World','https://feeds.bbci.co.uk/news/world/rss.xml','world','news',60),
    ('guardian-world','The Guardian · World','https://www.theguardian.com/world/rss','world','news',60),
    ('un-news','联合国新闻','https://news.un.org/feed/subscribe/en/news/all/rss.xml','world','official',60),
    ('ros-community','ROS 社区','https://discourse.ros.org/latest.rss','robotics','community',60),
    ('ieee-robotics','IEEE Spectrum · Robotics','https://spectrum.ieee.org/feeds/topic/robotics.rss','robotics','news',60),
    ('arxiv-robotics','arXiv · Robotics','https://rss.arxiv.org/rss/cs.RO','robotics','research',60),
    ('arxiv-ai','arXiv · AI','https://rss.arxiv.org/rss/cs.AI','ai','research',60),
    ('arxiv-control','arXiv · Systems and Control','https://rss.arxiv.org/rss/eess.SY','robotics','research',60),
    ('nvidia-dev','NVIDIA 开发者','https://developer.nvidia.com/blog/feed/','manufacturing','industry',60),
    ('github-blog','GitHub Blog','https://github.blog/feed/','software','industry',60),
    ('nature','Nature','https://www.nature.com/nature.rss','science','research',60),
]
KEYWORDS = {
    'robotics':['robot','机器人','机械臂','ros 2','ros2','motion control','运动控制','autonomous','自动驾驶','embodied','具身'],
    'ai':['artificial intelligence','machine learning','deep learning','llm','language model','大模型','人工智能','神经网络','openai','anthropic','deepseek'],
    'manufacturing':['semiconductor','chip','芯片','半导体','制造','工业','电机','embedded','嵌入式','stm32','microcontroller','nvidia','cuda'],
    'software':['linux','c++','python','github','open source','开源','compiler','编译器','release','版本'],
    'economy':['economy','economic','inflation','interest rate','tariff','trade','央行','经济','关税','利率','产业','投资'],
    'health':['health','vaccine','disease','public health','健康','疫苗','疾病','流感'],
    'education':['education','university','admission','scholarship','教育','招生','考研','大学','奖学金'],
}


def classify(title, topic, kind):
    text = title.casefold()
    topics = [topic]
    for key, words in KEYWORDS.items():
        if any(w in text for w in words) and key not in topics:
            topics.append(key)
    relevant = any(t in topics for t in ('robotics','ai','manufacturing','software','education'))
    important = any(w in text for w in ('earthquake','ceasefire','election','declares war','地震','停火','大选','重大事故','招生简章','报名截止','critical vulnerability','security advisory','严重漏洞'))
    level = 'high' if important else 'medium' if relevant or topic in ('world','economy') else 'low'
    reason = '标题命中重大事件/截止/安全词，请核对原文' if important else '与你关注的工程、AI 或教育领域相关' if relevant else '世界与经济动态' if level == 'medium' else '一般信息'
    return topics, level, reason
