-- Seed hotlist_ai_roles with 94 industry roles across multiple categories.

DO $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT id INTO v_account_id FROM public.accounts ORDER BY created_at ASC LIMIT 1;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No accounts found to assign roles to';
  END IF;

  INSERT INTO public.hotlist_ai_roles
    (account_id, category, target_role, years_exp, visa_status, employment_type, work_type, preferred_locations, min_rate_usd_per_hr, max_rate_usd_per_hr, relocation_open, priority_skills, schedule_frequency, is_active)
  VALUES
    -- Software Development
    (v_account_id, 'backend',    'Java Developer',                5,  'ANY',    'Contract', 'Hybrid',  'Dallas, TX',          65,  95,  true,  'Java 11/17, Spring Boot, Microservices',            'disabled', false),
    (v_account_id, 'backend',    'Java Full Stack Developer',     8,  'USC/GC', 'Contract', 'Remote',  'Austin, TX',          85,  120, false, 'Java, React/Angular, AWS, CI/CD',                   'disabled', false),
    (v_account_id, 'backend',    'Python Developer',              6,  'ANY',    'Contract', 'Remote',  'Seattle, WA',         75,  110, false, 'Python, Django/FastAPI, PostgreSQL',                 'disabled', false),
    (v_account_id, 'backend',    '.NET Developer',                7,  'USC/GC', 'Contract', 'Hybrid',  'Chicago, IL',         70,  105, true,  'C#, .NET Core, Azure, SQL Server',                  'disabled', false),
    (v_account_id, 'backend',    'C# Developer',                  5,  'ANY',    'Contract', 'Hybrid',  'Charlotte, NC',       65,  95,  true,  'C#, ASP.NET, Entity Framework, SQL',                'disabled', false),
    (v_account_id, 'backend',    'Full Stack Developer',          6,  'ANY',    'Contract', 'Hybrid',  'Denver, CO',          75,  115, true,  'JavaScript/TS, Node, React, SQL',                   'disabled', false),
    (v_account_id, 'front-end',  'Frontend Developer (React.js)', 5,  'ANY',    'Contract', 'Remote',  'New York, NY',        65,  100, false, 'React.js, Redux, TypeScript, Jest',                 'disabled', false),
    (v_account_id, 'front-end',  'Frontend Developer (Angular)',  8,  'ANY',    'Contract', 'Hybrid',  'Atlanta, GA',         70,  110, true,  'Angular 15+, RxJS, NgRx, HTML/CSS',                 'disabled', false),
    (v_account_id, 'backend',    'Node.js Developer',             5,  'USC/GC', 'Contract', 'Remote',  'San Francisco, CA',   75,  115, false, 'Node.js, Express, MongoDB, AWS',                    'disabled', false),
    (v_account_id, 'backend',    'Golang Developer',              6,  'USC/GC', 'Contract', 'Remote',  'San Jose, CA',        85,  130, false, 'Go, Microservices, gRPC, Kubernetes',               'disabled', false),
    (v_account_id, 'backend',    'PHP Developer',                 5,  'ANY',    'Contract', 'Remote',  'Phoenix, AZ',         55,  85,  false, 'PHP 8+, Laravel, MySQL, REST APIs',                 'disabled', false),
    (v_account_id, 'backend',    'Ruby on Rails Developer',       6,  'ANY',    'Contract', 'Remote',  'Salt Lake City, UT',  70,  105, false, 'Ruby on Rails, PostgreSQL, RSpec, Redis',            'disabled', false),
    (v_account_id, 'backend',    'C++ Developer',                 7,  'USC/GC', 'Contract', 'Onsite',  'Chicago, IL',         85,  130, true,  'C++17/20, Multithreading, STL, Linux',              'disabled', false),

    -- AI & Machine Learning
    (v_account_id, 'ai',  'AI Engineer',              5,  'USC/GC', 'Contract', 'Remote',  'San Jose, CA',        90,  135, false, 'Python, PyTorch, TensorFlow, MLOps',                'disabled', false),
    (v_account_id, 'ai',  'Generative AI Engineer',   5,  'USC/GC', 'Contract', 'Remote',  'San Francisco, CA',   100, 150, false, 'LLMs, LangChain, RAG, Prompt Eng',                  'disabled', false),
    (v_account_id, 'ml',  'Machine Learning Engineer', 6, 'ANY',    'Contract', 'Hybrid',  'Seattle, WA',         95,  140, true,  'Python, Scikit-learn, AWS SageMaker',                'disabled', false),
    (v_account_id, 'ai',  'NLP Engineer',             6,  'USC/GC', 'Contract', 'Remote',  'Boston, MA',          90,  135, false, 'Python, NLTK, Transformers, SpaCy',                  'disabled', false),
    (v_account_id, 'ml',  'Computer Vision Engineer', 7,  'USC/GC', 'Contract', 'Hybrid',  'San Diego, CA',       95,  140, true,  'OpenCV, PyTorch, YOLO, TensorRT',                   'disabled', false),
    (v_account_id, 'ml',  'MLOps Engineer',           6,  'USC/GC', 'Contract', 'Remote',  'Austin, TX',          90,  135, false, 'MLflow, Kubeflow, AWS SageMaker, CI/CD',             'disabled', false),
    (v_account_id, 'ai',  'LLM Engineer',             5,  'USC/GC', 'Contract', 'Remote',  'New York, NY',        105, 155, false, 'Fine-tuning, Llama, OpenAI APIs, Vector DBs',        'disabled', false),
    (v_account_id, 'ai',  'Prompt Engineer',          5,  'ANY',    'Contract', 'Remote',  'San Francisco, CA',   70,  110, false, 'LLM Evaluation, Few-Shot Prompting, Python',         'disabled', false),

    -- Data Engineering & Analytics
    (v_account_id, 'data', 'Data Engineer',        6,  'ANY',    'Contract', 'Remote',  'Austin, TX',          85,  120, false, 'Python, SQL, Spark, Airflow',                        'disabled', false),
    (v_account_id, 'data', 'Data Scientist',       5,  'USC/GC', 'Contract', 'Hybrid',  'Boston, MA',          80,  115, true,  'Python, SQL, Statistical Modeling',                  'disabled', false),
    (v_account_id, 'data', 'Data Analyst',         5,  'ANY',    'Contract', 'Hybrid',  'Tampa, FL',           50,  75,  true,  'SQL, Excel, Tableau, Python',                        'disabled', false),
    (v_account_id, 'data', 'BI Developer',         6,  'ANY',    'Contract', 'Remote',  'Dallas, TX',          60,  90,  false, 'Power BI, Tableau, SQL, Data Modeling',               'disabled', false),
    (v_account_id, 'data', 'Power BI Developer',   5,  'ANY',    'Contract', 'Hybrid',  'Chicago, IL',         60,  90,  true,  'Power BI, DAX, SQL, Data Viz',                       'disabled', false),
    (v_account_id, 'data', 'Tableau Developer',    5,  'ANY',    'Contract', 'Remote',  'Atlanta, GA',         55,  85,  false, 'Tableau Desktop/Server, SQL, ETL',                   'disabled', false),
    (v_account_id, 'data', 'SQL Developer',        7,  'ANY',    'Contract', 'Remote',  'Dallas, TX',          60,  90,  false, 'T-SQL/PL-SQL, Stored Procs, Tuning',                 'disabled', false),
    (v_account_id, 'data', 'ETL Developer',        6,  'ANY',    'Contract', 'Hybrid',  'Columbus, OH',        60,  90,  true,  'Informatica, SSIS, SQL, Data Warehousing',            'disabled', false),
    (v_account_id, 'data', 'Snowflake Developer',  6,  'ANY',    'Contract', 'Remote',  'Dallas, TX',          90,  130, false, 'Snowflake, SQL, DBT, ETL',                           'disabled', false),
    (v_account_id, 'data', 'Databricks Engineer',  7,  'USC/GC', 'Contract', 'Remote',  'Chicago, IL',         95,  140, false, 'Databricks, PySpark, Delta Lake',                    'disabled', false),
    (v_account_id, 'data', 'Big Data Engineer',    7,  'ANY',    'Contract', 'Hybrid',  'Minneapolis, MN',     85,  125, true,  'Hadoop, Spark, Hive, Scala/Python',                  'disabled', false),
    (v_account_id, 'data', 'Hadoop Developer',     6,  'ANY',    'Contract', 'Onsite',  'Charlotte, NC',       70,  100, true,  'HDFS, MapReduce, Hive, Pig, Java',                   'disabled', false),

    -- Cloud & DevOps
    (v_account_id, 'devops', 'AWS Cloud Engineer',              6,  'ANY',    'Contract', 'Hybrid',  'Washington, DC',      85,  125, true,  'AWS, Terraform, Python, Linux',                      'disabled', false),
    (v_account_id, 'devops', 'Azure Cloud Engineer',            6,  'USC/GC', 'Contract', 'Remote',  'Atlanta, GA',         85,  125, false, 'Azure (AKS, ARM), PowerShell, C#',                   'disabled', false),
    (v_account_id, 'devops', 'Google Cloud Engineer (GCP)',     6,  'USC/GC', 'Contract', 'Remote',  'Seattle, WA',         85,  130, false, 'GCP, Anthos, BigQuery, Terraform',                   'disabled', false),
    (v_account_id, 'devops', 'DevOps Engineer',                 6,  'ANY',    'Contract', 'Remote',  'Austin, TX',          85,  130, false, 'CI/CD, Jenkins, Terraform, Docker',                  'disabled', false),
    (v_account_id, 'devops', 'Site Reliability Engineer (SRE)', 7,  'USC/GC', 'Contract', 'Remote',  'San Francisco, CA',   95,  145, false, 'Python/Go, Kubernetes, Prometheus, Chaos Eng',        'disabled', false),
    (v_account_id, 'devops', 'Platform Engineer',               7,  'USC/GC', 'Contract', 'Remote',  'New York, NY',        95,  140, false, 'Internal Developer Platforms, K8s, IaC',              'disabled', false),
    (v_account_id, 'devops', 'Kubernetes Engineer',             7,  'USC/GC', 'Contract', 'Remote',  'Seattle, WA',         95,  145, false, 'K8s, Helm, Prometheus, AWS/Azure',                   'disabled', false),
    (v_account_id, 'devops', 'Docker Engineer',                 5,  'ANY',    'Contract', 'Hybrid',  'Denver, CO',          70,  105, true,  'Containerization, Microservices, Linux, Bash',        'disabled', false),
    (v_account_id, 'devops', 'Terraform Engineer',              6,  'USC/GC', 'Contract', 'Remote',  'Raleigh, NC',         80,  120, false, 'HCL, AWS/Azure, Module Dev, CI/CD',                  'disabled', false),
    (v_account_id, 'devops', 'Cloud Architect',                 9,  'USC/GC', 'Contract', 'Hybrid',  'Dallas, TX',          110, 160, true,  'Enterprise Architecture, Multi-Cloud, Security',      'disabled', false),

    -- QA & Testing
    (v_account_id, 'qa', 'Manual QA Engineer',            5,  'ANY',    'Contract', 'Hybrid',  'Phoenix, AZ',         40,  60,  true,  'Test Cases, JIRA, SQL, Regression Testing',           'disabled', false),
    (v_account_id, 'qa', 'Automation Test Engineer',      5,  'ANY',    'Contract', 'Hybrid',  'Dallas, TX',          55,  85,  true,  'Selenium/Cypress, Java/Python',                      'disabled', false),
    (v_account_id, 'qa', 'SDET',                          8,  'USC/GC', 'Contract', 'Remote',  'New York, NY',        80,  110, false, 'Test Framework Dev, CI/CD, Java',                    'disabled', false),
    (v_account_id, 'qa', 'Selenium Automation Engineer',  5,  'ANY',    'Contract', 'Remote',  'Atlanta, GA',         50,  80,  false, 'Selenium WebDriver, Java, TestNG, Maven',             'disabled', false),
    (v_account_id, 'qa', 'API Test Engineer',             5,  'ANY',    'Contract', 'Remote',  'Chicago, IL',         55,  85,  false, 'Postman, REST Assured, JMeter, JSON',                'disabled', false),
    (v_account_id, 'qa', 'Performance Test Engineer',     6,  'USC/GC', 'Contract', 'Hybrid',  'Charlotte, NC',       65,  95,  true,  'JMeter, LoadRunner, Dynatrace, APM',                 'disabled', false),

    -- Cybersecurity
    (v_account_id, 'security', 'Cybersecurity Analyst',       5,  'USC',    'Contract', 'Hybrid',  'Washington, DC',      60,  90,  true,  'SIEM, Incident Response, Vulnerability Mgmt',        'disabled', false),
    (v_account_id, 'security', 'Security Engineer',            6,  'USC',    'Contract', 'Remote',  'Arlington, VA',       90,  135, false, 'CISSP, Network Security, Python, Firewalls',          'disabled', false),
    (v_account_id, 'security', 'Cloud Security Engineer',      7,  'USC',    'Contract', 'Remote',  'Austin, TX',          95,  140, false, 'AWS GuardDuty, Prisma, IAM, Terraform',               'disabled', false),
    (v_account_id, 'security', 'SOC Analyst',                  5,  'USC',    'Contract', 'Onsite',  'San Antonio, TX',     50,  75,  true,  'Splunk, Sentinel, Threat Hunting, Log Analysis',      'disabled', false),
    (v_account_id, 'security', 'IAM Engineer',                 6,  'USC/GC', 'Contract', 'Hybrid',  'New York, NY',        80,  120, true,  'SailPoint, Okta, Ping Identity, SAML/OAuth',          'disabled', false),
    (v_account_id, 'security', 'Penetration Tester',           6,  'USC',    'Contract', 'Remote',  'Tampa, FL',           85,  130, false, 'Metasploit, Burp Suite, OSCP, Ethical Hacking',       'disabled', false),
    (v_account_id, 'security', 'GRC Consultant',               7,  'USC/GC', 'Contract', 'Hybrid',  'Chicago, IL',         80,  125, true,  'NIST, ISO 27001, SOC 2, Audit & Compliance',          'disabled', false),

    -- ERP & CRM
    (v_account_id, 'crm', 'Salesforce Developer',          5,  'ANY',    'Contract', 'Remote',  'Denver, CO',          75,  115, false, 'Apex, LWC, SOQL, Salesforce APIs',                   'disabled', false),
    (v_account_id, 'crm', 'Salesforce Administrator',      5,  'ANY',    'Contract', 'Hybrid',  'Orlando, FL',         50,  75,  true,  'Flow Builder, User Mgmt, Reports, Dashboards',        'disabled', false),
    (v_account_id, 'crm', 'Salesforce Business Analyst',   6,  'USC/GC', 'Contract', 'Remote',  'Dallas, TX',          65,  95,  false, 'Sales/Service Cloud, User Stories, UAT',               'disabled', false),
    (v_account_id, 'crm', 'ServiceNow Developer',          5,  'USC/GC', 'Contract', 'Hybrid',  'Washington, DC',      75,  115, true,  'ITSM, JavaScript, Glide API',                        'disabled', false),
    (v_account_id, 'crm', 'ServiceNow Administrator',      5,  'ANY',    'Contract', 'Remote',  'Atlanta, GA',         55,  80,  false, 'Service Catalog, Workflow Editor, Incident Mgmt',     'disabled', false),
    (v_account_id, 'crm', 'SAP ABAP Consultant',           7,  'ANY',    'Contract', 'Hybrid',  'Houston, TX',         80,  120, true,  'S/4HANA, OData, RICEF, ABAP Objects',                 'disabled', false),
    (v_account_id, 'crm', 'SAP FICO Consultant',           8,  'ANY',    'Contract', 'Hybrid',  'Houston, TX',         90,  130, true,  'SAP S/4HANA, FI/CO modules',                          'disabled', false),
    (v_account_id, 'crm', 'SAP MM Consultant',             7,  'ANY',    'Contract', 'Onsite',  'Detroit, MI',         80,  115, true,  'Procurement, Inventory Mgmt, Valuation',               'disabled', false),
    (v_account_id, 'crm', 'SAP SD Consultant',             7,  'ANY',    'Contract', 'Hybrid',  'Chicago, IL',         80,  115, true,  'Order-to-Cash, Pricing, Billing, Shipping',            'disabled', false),
    (v_account_id, 'crm', 'Oracle Cloud Consultant',       8,  'USC/GC', 'Contract', 'Remote',  'Philadelphia, PA',    85,  125, false, 'Oracle Fusion HCM/ERP, OTBI, Fast Formulas',           'disabled', false),
    (v_account_id, 'crm', 'Dynamics 365 Consultant',       6,  'USC/GC', 'Contract', 'Hybrid',  'Minneapolis, MN',     75,  110, true,  'D365 FO/CE, Power Platform, C#',                      'disabled', false),

    -- Infrastructure & Networking
    (v_account_id, 'devops', 'Linux Administrator',     5,  'ANY',    'Contract', 'Onsite',  'Dallas, TX',          50,  80,  true,  'RedHat/CentOS, Bash Scripting, Patching',              'disabled', false),
    (v_account_id, 'devops', 'Windows Administrator',   5,  'ANY',    'Contract', 'Hybrid',  'Phoenix, AZ',         45,  70,  true,  'Active Directory, PowerShell, Group Policy',            'disabled', false),
    (v_account_id, 'devops', 'Network Engineer',        6,  'USC/GC', 'Contract', 'Onsite',  'Atlanta, GA',         60,  90,  true,  'Cisco CCNA/CCNP, BGP/OSPF, Firewalls',                 'disabled', false),
    (v_account_id, 'devops', 'VMware Engineer',         7,  'USC/GC', 'Contract', 'Hybrid',  'St. Louis, MO',       70,  100, true,  'vSphere, NSX, ESXi, SAN Storage',                      'disabled', false),
    (v_account_id, 'devops', 'Systems Administrator',   5,  'ANY',    'Contract', 'Hybrid',  'Columbus, OH',        45,  70,  true,  'Windows/Linux Admin, Backups, Virtualization',          'disabled', false),
    (v_account_id, 'devops', 'Storage Engineer',        7,  'USC/GC', 'Contract', 'Remote',  'Houston, TX',         70,  105, false, 'NetApp, SAN/NAS, Dell EMC, Provisioning',               'disabled', false),

    -- Mobile Development
    (v_account_id, 'front-end', 'Android Developer',       5,  'ANY', 'Contract', 'Remote',  'Austin, TX',          65,  100, false, 'Kotlin, Java, Jetpack Compose, Android SDK',            'disabled', false),
    (v_account_id, 'front-end', 'iOS Developer',           5,  'ANY', 'Contract', 'Remote',  'San Francisco, CA',   70,  105, false, 'Swift, SwiftUI, Xcode, Objective-C',                    'disabled', false),
    (v_account_id, 'front-end', 'Flutter Developer',       5,  'ANY', 'Contract', 'Remote',  'Miami, FL',           60,  95,  false, 'Dart, Flutter SDK, State Management (Bloc/Provider)',    'disabled', false),
    (v_account_id, 'front-end', 'React Native Developer',  5,  'ANY', 'Contract', 'Remote',  'New York, NY',        65,  100, false, 'React Native, JavaScript/TypeScript, Redux',             'disabled', false),

    -- Business & Project Management
    (v_account_id, 'biz-dev', 'Business Analyst',            7,  'USC/GC', 'Contract', 'Hybrid',  'Charlotte, NC',       65,  95,  true,  'Agile, Jira, Requirements Gathering',                 'disabled', false),
    (v_account_id, 'biz-dev', 'Technical Business Analyst',  6,  'USC/GC', 'Contract', 'Remote',  'Chicago, IL',         70,  100, false, 'SQL, API Specs, Wireframing, Agile',                   'disabled', false),
    (v_account_id, 'biz-dev', 'Scrum Master',                6,  'USC/GC', 'Contract', 'Remote',  'Atlanta, GA',         65,  95,  false, 'CSM, Agile/SAFe, Jira, Coaching',                      'disabled', false),
    (v_account_id, 'biz-dev', 'Product Manager',             8,  'USC/GC', 'Contract', 'Hybrid',  'San Francisco, CA',   85,  130, true,  'Product Roadmap, OKRs, User Research',                 'disabled', false),
    (v_account_id, 'biz-dev', 'Project Manager',             7,  'USC/GC', 'Contract', 'Hybrid',  'Dallas, TX',          65,  95,  true,  'PMP, Budgeting, Risk Mgmt, MS Project',                'disabled', false),
    (v_account_id, 'biz-dev', 'Technical Project Manager',   8,  'USC/GC', 'Contract', 'Hybrid',  'New York, NY',        75,  115, true,  'PMP, SDLC, Stakeholder Mgmt',                         'disabled', false),
    (v_account_id, 'biz-dev', 'Program Manager',             10, 'USC/GC', 'Contract', 'Hybrid',  'Seattle, WA',         95,  140, true,  'Governance, Multi-project Delivery, Vendor Mgmt',      'disabled', false),

    -- Enterprise & Integration
    (v_account_id, 'backend', 'MuleSoft Developer',      6,  'ANY',    'Contract', 'Remote',  'Dallas, TX',          75,  110, false, 'Anypoint Platform, DataWeave, RAML, Mule 4',           'disabled', false),
    (v_account_id, 'backend', 'Boomi Developer',         5,  'ANY',    'Contract', 'Remote',  'Chicago, IL',         70,  100, false, 'Dell Boomi AtomSphere, Integration Processes',           'disabled', false),
    (v_account_id, 'data',    'Informatica Developer',   6,  'ANY',    'Contract', 'Hybrid',  'Tampa, FL',           60,  90,  true,  'PowerCenter, IDMC, ETL Performance Tuning',              'disabled', false),
    (v_account_id, 'backend', 'Tibco Developer',         7,  'ANY',    'Contract', 'Hybrid',  'Houston, TX',         65,  95,  true,  'BusinessWorks, Enterprise Message Service (EMS)',         'disabled', false),
    (v_account_id, 'backend', 'Kafka Developer',         6,  'USC/GC', 'Contract', 'Remote',  'Austin, TX',          80,  120, false, 'Apache Kafka, Event-driven architecture, Java',          'disabled', false),

    -- Emerging Technologies
    (v_account_id, 'ai',       'Blockchain Developer',        5,  'USC/GC', 'Contract', 'Remote',  'New York, NY',        85,  135, false, 'Solidity, Ethereum, Smart Contracts, Web3.js',          'disabled', false),
    (v_account_id, 'devops',   'IoT Engineer',                6,  'USC/GC', 'Contract', 'Hybrid',  'San Jose, CA',        80,  120, true,  'Embedded C/C++, MQTT, AWS IoT, Sensors',                'disabled', false),
    (v_account_id, 'backend',  'Robotics Engineer',           6,  'USC/GC', 'Contract', 'Onsite',  'Pittsburgh, PA',      85,  125, true,  'ROS/ROS2, C++, Python, Motion Planning',                 'disabled', false),
    (v_account_id, 'front-end','AR/VR Developer',             5,  'ANY',    'Contract', 'Hybrid',  'Los Angeles, CA',     75,  115, true,  'Unity/Unreal Engine, C#, Spatial Computing',             'disabled', false),
    (v_account_id, 'backend',  'Embedded Software Engineer',  6,  'USC/GC', 'Contract', 'Onsite',  'Detroit, MI',         75,  110, true,  'Embedded C/C++, RTOS, Microcontrollers, CAN',            'disabled', false)

  ON CONFLICT DO NOTHING;
END $$;
