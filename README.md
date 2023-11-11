### checkfpi

#### Description
This tool, created by MrBOOND, is designed for domain enumeration and analysis. It extracts subdomains, checks for hidden subdomains, gathers DNS and SSL information, and provides additional functionalities like scanning for subdomains, CDN-SSL scanning, SNI scanning, and IP range scanning.

#### Features
- Subdomain extraction using sublist3r and crt.sh
- DNS and SSL information gathering
- Hidden subdomain discove
- Duplicate removal from tration with Bugscanner-go for additional scanning options
- Optical inspection of ranges
- Uses sublist3r to extract subdomains of the target domain.Hidden Subdomain Discovery:Utilizes crt.sh to find hidden subdomains related to the target domain.DNS and SSL Information Gathering:Retrieves DNS information and SSL certificates for the discovered subdomains.Tool Menus:Provides a user-friendly menu interface for various domain-related tasks.Bugscanner Integration:Allows scanning for subdomains, CDN-SSL, and SNI using bugscanner-go tool.CloudIP Scanning:Scans an IP range for both HTTP and HTTPS servers.
  
## Usage
Run the script: python checkfpi.pyEnter the target domain when prompted.Subdomains and Hidden Subdomains are displayed along with their DNS information.Results are saved to domains.txt.Additional options include using bugscanner for subdomain scanning and other advanced scans.

1. Install the required dependencies by running:
2. pkg update && pkg upgrade -y
3. pip install requests loguru multithreading bugscanner
4. pkg install golang
5. pkg install vim
6. pkg install pip
7. apt install cfscrape
8. git clone https://github.com/BOONNDD/scan
9. cd scan
10. pip install -r requirements.txt
11. python3 checkfpi.py


## 🙂


### Connect with Us:
Join our Telegram channel [@BO_NND](https://t.me/BO_NND) for updates, discussions, and support related to checkfpi.py. Stay informed about the latest features, bug fixes, and connect with the community.Feel free to customize the message or provide any additional information 
## المطورون و المساهمون: 
[@Mr_PYT_HON](https://t.me/Mr_PYT_HON)

[@Mr_BOND](https://t.me/Mr_BOOND) 

[@Monther_Mohammed](https://t.me/Monther_Mohammed)
